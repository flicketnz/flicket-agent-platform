import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
} from "@langchain/langgraph";
import {
  ChannelVersions,
  CheckpointListOptions,
  getCheckpointId,
  PendingWrite,
  WRITES_IDX_MAP,
} from "@langchain/langgraph-checkpoint";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectModel, Item, type Model } from "nestjs-dynamoose";

import type { CheckpointerPort } from "./ports/checkpointer.port";
import { Checkpoints, CheckpointsKey } from "./schemas/checkpoints.interface";

// Define TASKS constant locally if not available from imports
const TASKS = "__pregel_tasks__";

@Injectable()
export class DynamoDBCheckpointerAdapter
  extends BaseCheckpointSaver
  implements CheckpointerPort, OnModuleInit
{
  private readonly logger = new Logger(DynamoDBCheckpointerAdapter.name);

  public instance!: BaseCheckpointSaver;

  constructor(
    @InjectModel("Checkpoints")
    private checkpointsModel: Model<Checkpoints, CheckpointsKey>,
  ) {
    super();
  }

  onModuleInit() {
    this.instance = this;
  }

  private _generateCheckpointKey(
    checkpointNamespace: string,
    checkpointId: string,
  ): string {
    return `checkpoint#${checkpointNamespace}#${checkpointId}`;
  }

  private _generateWriteKey(
    checkpointNamespace: string,
    checkpointId: string,
    taskId: string,
    writeIdx: number,
  ): string {
    return `write#${checkpointNamespace}#${checkpointId}#${taskId}#${writeIdx}`;
  }

  private _parseCheckpointKey(recordId: string): {
    threadId: string;
    checkpointNamespace: string;
    checkpointId: string;
  } {
    const parts = recordId.split("#");
    if (parts[0] !== "checkpoint") {
      throw new Error(`Invalid checkpoint record ID: ${recordId}`);
    }
    return {
      threadId: "", // threadId is stored separately in the hash key
      checkpointNamespace: parts[1] || "",
      checkpointId: parts[2],
    };
  }

  private _parseWriteKey(recordId: string): {
    checkpointNamespace: string;
    checkpointId: string;
    taskId: string;
    writeIdx: number;
  } {
    const parts = recordId.split("#");
    if (parts[0] !== "write") {
      throw new Error(`Invalid write record ID: ${recordId}`);
    }
    return {
      checkpointNamespace: parts[1] || "",
      checkpointId: parts[2],
      taskId: parts[3],
      writeIdx: parseInt(parts[4], 10),
    };
  }

  private _serializeData(data: Uint8Array): string {
    return Buffer.from(data).toString("base64");
  }

  private _deserializeData(data: string): Uint8Array {
    return new Uint8Array(Buffer.from(data, "base64"));
  }

  private _isStoredCheckpointData(item: Item<Checkpoints>) {
    return (
      item.recordId.startsWith("checkpoint#") &&
      typeof item.checkpoint === "string" &&
      typeof item.metadata === "string"
    );
  }

  private async _getWrites(
    threadId: string,
    checkpointNamespace: string,
    checkpointId: string,
    parentCheckpointId?: string,
  ): Promise<[string, string, unknown][]> {
    try {
      // Get all writes for this checkpoint
      const writeResults = await this.checkpointsModel
        .query({ threadId })
        .filter("recordId")
        .beginsWith(`write#${checkpointNamespace}#${checkpointId}#`)
        .exec();

      const writes: [string, string, unknown][] = await Promise.all(
        writeResults.map(
          async (writeRecord): Promise<[string, string, unknown]> => {
            const value = (await this.serde.loadsTyped(
              "json",
              this._deserializeData(writeRecord.value!),
            )) as unknown;
            return [writeRecord.taskId!, writeRecord.channel!, value];
          },
        ),
      );

      // If there's a parent checkpoint and this is an older version, migrate pending sends
      if (parentCheckpointId) {
        const parentWrites = await this._getParentWrites(
          threadId,
          checkpointNamespace,
          parentCheckpointId,
        );
        writes.push(
          ...parentWrites.filter(([_taskId, channel]) => channel === TASKS),
        );
      }

      return writes;
    } catch (error) {
      this.logger.warn(
        `Failed to get writes for checkpoint ${checkpointId}:`,
        error,
      );
      return [];
    }
  }

  private async _getParentWrites(
    threadId: string,
    checkpointNamespace: string,
    parentCheckpointId: string,
  ): Promise<[string, string, unknown][]> {
    try {
      const writeResults = await this.checkpointsModel
        .query({ threadId })
        .filter("recordId")
        .beginsWith(`write#${checkpointNamespace}#${parentCheckpointId}#`)
        .exec();

      return await Promise.all(
        writeResults.map(
          async (writeRecord): Promise<[string, string, unknown]> => {
            const value = (await this.serde.loadsTyped(
              "json",
              this._deserializeData(writeRecord.value!),
            )) as Record<string, unknown>;
            return [writeRecord.taskId!, writeRecord.channel!, value];
          },
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to get parent writes for checkpoint ${parentCheckpointId}:`,
        error,
      );
      return [];
    }
  }

  private async _migratePendingSends(
    mutableCheckpoint: Checkpoint<string, string>,
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const parentRecordId = this._generateCheckpointKey(
      checkpointNs,
      parentCheckpointId,
    );

    try {
      const parentData = await this.checkpointsModel.get({
        threadId,
        recordId: parentRecordId,
      });
      if (
        parentData &&
        parentData.recordId.startsWith("checkpoint#") &&
        parentData.checkpoint &&
        parentData.metadata
      ) {
        // Query for writes related to this parent checkpoint
        const writeRecordIdPrefix = `write#${checkpointNs}#${parentCheckpointId}#`;
        const writeResults = await this.checkpointsModel
          .query({ threadId })
          .filter("recordId")
          .beginsWith(writeRecordIdPrefix)
          .exec();

        await Promise.all(
          writeResults
            .filter((write) => write.channel === TASKS)
            .map(
              async (write) =>
                (await this.serde.loadsTyped(
                  "json",
                  this._deserializeData(write.value!),
                )) as Record<string, unknown>,
            ),
        );

        mutableCheckpoint.channel_values ??= {};
        mutableCheckpoint.channel_versions ??= {};

        // eslint-disable-next-line unused-imports/no-unused-vars
        const currentVersions = Object.values(
          mutableCheckpoint.channel_versions,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to migrate pending sends for parent ${parentCheckpointId}:`,
        error,
      );
    }
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.logger.verbose("Starting getTuple operation");
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs =
      (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);

    this.logger.debug(`thread: ${threadId}, checkpointId: ${checkpointId}`);

    if (!threadId) {
      return undefined;
    }

    try {
      if (checkpointId) {
        // Get specific checkpoint
        const recordId = this._generateCheckpointKey(
          checkpointNs,
          checkpointId,
        );
        const result = await this.checkpointsModel.get({ threadId, recordId });

        if (result && this._isStoredCheckpointData(result)) {
          this.logger.debug("Checkout found for specific checkpointId");
          return await this._buildCheckpointTuple(
            result,
            config,
            threadId,
            checkpointNs,
            checkpointId,
          );
        }
      } else {
        // Get latest checkpoint for thread
        const results = await this.checkpointsModel
          .query({ threadId })
          .filter("recordId")
          .beginsWith(`checkpoint#${checkpointNs}#`)
          // .limit(10)
          .exec();
        this.logger.debug(`Found ${results.length} checkpoints`);
        if (results.length === 0) {
          return undefined;
        }

        // Sort by record ID descending (most recent first) and get the first one
        const sortedResults = results.sort((a, b) => {
          const aId = a.recordId || "";
          const bId = b.recordId || "";
          return bId.localeCompare(aId);
        });

        const latestCheckpoint = sortedResults[0];

        if (this._isStoredCheckpointData(latestCheckpoint)) {
          const parsed = this._parseCheckpointKey(latestCheckpoint.recordId);
          this.logger.debug("Checkout found for latest checkpoint in thread");
          return await this._buildCheckpointTuple(
            latestCheckpoint,
            config,
            threadId,
            checkpointNs,
            parsed.checkpointId,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to get checkpoint tuple:`, error);
    }

    return undefined;
  }

  private async _buildCheckpointTuple(
    storedData: Item<Checkpoints>,
    config: RunnableConfig,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<CheckpointTuple> {
    const deserializedCheckpoint = (await this.serde.loadsTyped(
      "json",
      this._deserializeData(storedData.checkpoint!),
    )) as Checkpoint<string, string>;

    // Get all writes for this checkpoint
    const writes = await this._getWrites(
      threadId,
      checkpointNs,
      checkpointId,
      storedData.parentCheckpointId,
    );

    // Handle migration for older checkpoint versions
    if (deserializedCheckpoint.v < 4 && storedData.parentCheckpointId) {
      await this._migratePendingSends(
        deserializedCheckpoint,
        threadId,
        checkpointNs,
        storedData.parentCheckpointId,
      );
    }

    const checkpointTuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
        },
      },
      checkpoint: deserializedCheckpoint,
      metadata: (await this.serde.loadsTyped(
        "json",
        this._deserializeData(storedData.metadata!),
      )) as CheckpointMetadata,
      pendingWrites: writes,
    };

    if (storedData.parentCheckpointId) {
      checkpointTuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: storedData.parentCheckpointId,
        },
      };
    }

    return checkpointTuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.logger.verbose("Starting List operation");
    const { before, limit, filter } = options ?? {};
    const threadIds: string[] = config.configurable?.thread_id
      ? [config.configurable.thread_id as string]
      : [];
    const configCheckpointNamespace =
      (config.configurable?.checkpoint_ns as string | undefined) ?? "";

    const configCheckpointId = getCheckpointId(config);

    if (threadIds.length === 0) {
      // If no specific thread_id, we'd need to scan all threads, which is expensive
      // For now, return empty if no thread_id specified
      return;
    }

    let processedCount = 0;

    for (const threadId of threadIds) {
      try {
        let query = this.checkpointsModel
          .query({ threadId })
          .filter("recordId")
          .beginsWith("checkpoint#");

        // Filter by namespace if specified
        if (configCheckpointNamespace) {
          query = query
            .filter("recordId")
            .beginsWith(`checkpoint#${configCheckpointNamespace}#`);
        }

        // Apply before filter if specified
        if (before?.configurable?.checkpoint_id) {
          const beforeKey = this._generateCheckpointKey(
            configCheckpointNamespace,
            getCheckpointId(before),
          );
          query = query.filter("recordId").lt(beforeKey);
        }

        const results = await query.exec();

        // Sort by record ID descending (most recent first)
        const sortedResults = results.sort((a, b) => {
          const aId = a.recordId || "";
          const bId = b.recordId || "";
          return bId.localeCompare(aId);
        });

        for (const result of sortedResults) {
          if (limit !== undefined && processedCount >= limit) {
            return;
          }

          if (!this._isStoredCheckpointData(result)) {
            continue;
          }

          const parsed = this._parseCheckpointKey(result.recordId);

          // Filter by specific checkpoint ID if provided
          if (
            configCheckpointId &&
            parsed.checkpointId !== configCheckpointId
          ) {
            continue;
          }

          const metadata = (await this.serde.loadsTyped(
            "json",
            this._deserializeData(result.metadata!),
          )) as CheckpointMetadata;

          // Apply metadata filter
          if (
            filter &&
            !Object.entries(filter).every(
              ([key, value]) =>
                (metadata as Record<string, unknown>)[key] === value,
            )
          ) {
            continue;
          }

          const checkpointTuple = await this._buildCheckpointTuple(
            result,
            config,
            threadId,
            parsed.checkpointNamespace,
            parsed.checkpointId,
          );

          yield checkpointTuple;
          processedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to list checkpoints for thread ${threadId}:`,
          error,
        );
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    this.logger.verbose("Starting Put operation");

    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNamespace =
      (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    if (!threadId) {
      throw new Error(
        `Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.`,
      );
    }

    try {
      const [[, serializedCheckpoint], [, serializedMetadata]] =
        await Promise.all([
          this.serde.dumpsTyped(checkpoint),
          this.serde.dumpsTyped(metadata),
        ]);

      const recordId = this._generateCheckpointKey(
        checkpointNamespace,
        checkpoint.id,
      );

      await this.checkpointsModel.create({
        threadId,
        recordId,
        checkpoint: this._serializeData(serializedCheckpoint),
        metadata: this._serializeData(serializedMetadata),
        parentCheckpointId: config.configurable?.checkpoint_id as
          | string
          | undefined,
      });

      this.logger.debug("Put operation complete");

      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: checkpoint.id,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to put checkpoint:`, error);
      throw error;
    }
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.logger.verbose("Starting PutWrites operation");
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNamespace =
      (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);

    if (!threadId) {
      throw new Error(
        `Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property`,
      );
    }

    if (!checkpointId) {
      throw new Error(
        `Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.`,
      );
    }

    try {
      // Store each write as a separate record
      await Promise.all(
        writes.map(async ([channel, value], idx) => {
          const [, serializedValue] = await this.serde.dumpsTyped(value);
          const writeIdx = WRITES_IDX_MAP[channel] || idx;

          // Skip if writeIdx is negative (indicates we shouldn't store this write)
          if (writeIdx < 0) {
            return;
          }

          const recordId = this._generateWriteKey(
            checkpointNamespace,
            checkpointId,
            taskId,
            writeIdx,
          );

          // Store the write as a separate record
          await this.checkpointsModel.create({
            threadId,
            recordId,
            taskId,
            channel,
            value: this._serializeData(serializedValue),
            writeIdx,
          });
        }),
      );

      this.logger.debug("PutWrites operation complete");
    } catch (error) {
      this.logger.error(`Failed to put writes:`, error);
      throw error;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.logger.verbose("Starting DeleteThread operation");
    try {
      // Delete all records for this thread (both checkpoints and writes)
      const results = await this.checkpointsModel.query({ threadId }).exec();

      await Promise.all(
        results.map(async (result) => {
          await this.checkpointsModel.delete({
            threadId,
            recordId: result.recordId,
          });
        }),
      );

      this.logger.debug(
        `Deleted ${results.length} records for thread ${threadId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to delete thread ${threadId}:`, error);
      throw error;
    }
  }
}
