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
import { SortOrder } from "dynamoose/dist/General";
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
    // return Buffer.from(data).toString("base64");
    return Buffer.from(data).toString("utf8");
  }

  private _deserializeData(data: string): Uint8Array {
    // return new Uint8Array(Buffer.from(data, "base64"));
    return new Uint8Array(Buffer.from(data, "utf8"));
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
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs =
      (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);

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
          .sort(SortOrder.descending)
          .limit(1)
          .exec();
        if (results.length === 0) {
          return undefined;
        }

        const latestCheckpoint = results[0];

        if (this._isStoredCheckpointData(latestCheckpoint)) {
          const parsed = this._parseCheckpointKey(latestCheckpoint.recordId);
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
      ? Array.isArray(config.configurable.thread_id)
        ? (config.configurable.thread_id as string[])
        : [config.configurable.thread_id as string]
      : [];

    // Use undefined if checkpoint_ns is not provided, vs "" if explicitly set to ""
    const configCheckpointNamespace = config.configurable?.checkpoint_ns as
      | string
      | undefined;
    const hasExplicitNamespace = "checkpoint_ns" in (config.configurable ?? {});

    const configCheckpointId = getCheckpointId(config);

    let processedCount = 0;

    if (threadIds.length === 0) {
      // If no specific thread_id, use scan (limited filtering capabilities)
      try {
        // Build scan with available filter expressions
        let scanQuery = this.checkpointsModel.scan();

        // Add filter for checkpoint records only
        scanQuery = scanQuery.filter("recordId").beginsWith("checkpoint#");

        // DynamoDB scan doesn't support complex filtering, so we still need some post-processing
        const scanResults = await scanQuery.exec();

        // Apply improved sorting to the results
        const sortedResults = this._sortCheckpointResults(scanResults);

        for (const result of sortedResults) {
          if (limit !== undefined && processedCount >= limit) {
            return;
          }

          const parsed = this._parseCheckpointKey(result.recordId);

          // Filter by namespace if explicitly specified
          if (hasExplicitNamespace) {
            if (
              parsed.checkpointNamespace !== (configCheckpointNamespace ?? "")
            ) {
              continue;
            }
          }

          // Filter by specific checkpoint ID if provided
          if (
            configCheckpointId &&
            parsed.checkpointId !== configCheckpointId
          ) {
            continue;
          }

          // Apply before filter if specified
          if (before?.configurable?.checkpoint_id) {
            const beforeKey = this._generateCheckpointKey(
              (before.configurable.checkpoint_ns as string) || "",
              getCheckpointId(before),
            );
            if (result.recordId >= beforeKey) {
              continue;
            }
          }

          // Apply metadata filter (requires deserialization)
          if (filter) {
            const metadata = (await this.serde.loadsTyped(
              "json",
              this._deserializeData(result.metadata!),
            )) as CheckpointMetadata;

            if (
              !Object.entries(filter).every(
                ([key, value]) =>
                  (metadata as Record<string, unknown>)[key] === value,
              )
            ) {
              continue;
            }
          }

          const checkpointTuple = await this._buildCheckpointTuple(
            result,
            config,
            result.threadId,
            parsed.checkpointNamespace,
            parsed.checkpointId,
          );

          yield checkpointTuple;
          processedCount++;
        }
      } catch (error) {
        this.logger.error(`Failed to scan checkpoints:`, error);
      }
    } else {
      // If specific thread_ids are provided, use optimized query with DynamoDB-level filtering
      for (const threadId of threadIds) {
        try {
          let checkpointPrefix = "checkpoint#";

          // Build optimized prefix for namespace filtering
          if (hasExplicitNamespace) {
            if (configCheckpointNamespace !== undefined) {
              checkpointPrefix = `checkpoint#${configCheckpointNamespace}#`;
            } else {
              checkpointPrefix = "checkpoint##";
            }
          }
          // console.log("------------------> pk: ", threadIds);
          // console.log("------------------> sortkey: ", checkpointPrefix);

          // Build query with DynamoDB-level sorting and filtering
          let query = this.checkpointsModel
            .query({ threadId })
            .where("recordId")
            .beginsWith(checkpointPrefix)
            .sort(SortOrder.descending); // DynamoDB-level sorting

          // Apply limit at DynamoDB level for better performance
          if (limit !== undefined) {
            const remainingLimit = limit - processedCount;
            if (remainingLimit <= 0) {
              return;
            }
            query = query.limit(remainingLimit * 2); // Get extra to account for filtering
          }

          const results = await query.exec();

          // console.log("------------------> q results: ", results);
          // returns 2 checkpoints

          for (const result of results) {
            if (limit !== undefined && processedCount >= limit) {
              return;
            }
            // console.log("==============> Before isStored");
            if (!this._isStoredCheckpointData(result)) {
              continue;
            }
            // console.log("==============> Before after");

            const parsed = this._parseCheckpointKey(result.recordId);

            // console.log("==============> Before checkpointIdMatch");
            // Filter by specific checkpoint ID if provided
            if (
              configCheckpointId &&
              parsed.checkpointId !== configCheckpointId
            ) {
              continue;
            }
            // console.log("==============> after checkpointIdMatch");

            // console.log("==============> before filter applied");
            // Apply before filter if specified
            if (before?.configurable?.checkpoint_id) {
              const beforeKey = this._generateCheckpointKey(
                (before.configurable.checkpoint_ns as string) || "",
                getCheckpointId(before),
              );
              if (result.recordId >= beforeKey) {
                continue;
              }
            }
            // console.log("==============> after filter applied");

            // Apply metadata filter (requires deserialization)
            if (filter) {
              const metadata = (await this.serde.loadsTyped(
                "json",
                this._deserializeData(result.metadata!),
              )) as CheckpointMetadata;

              if (
                !Object.entries(filter).every(
                  ([key, value]) =>
                    (metadata as Record<string, unknown>)[key] === value,
                )
              ) {
                continue;
              }
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
  }

  /**
   * Sort checkpoint results by recordId in descending order
   * This provides consistent ordering since DynamoDB scan doesn't support sorting
   */
  private _sortCheckpointResults(
    results: Item<Checkpoints>[],
  ): Item<Checkpoints>[] {
    return results.sort((a, b) => {
      // Sort by recordId in descending order for most recent first
      const comparison = b.recordId.localeCompare(a.recordId);

      // If recordIds are the same, sort by checkpointTs if available
      if (comparison === 0 && a.checkpointTs && b.checkpointTs) {
        return b.checkpointTs.localeCompare(a.checkpointTs);
      }

      return comparison;
    });
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
      // Create a copy of the checkpoint to modify
      const modifiedCheckpoint = { ...checkpoint };

      // Only store channel_values that have changed (are present in newVersions)
      if (
        modifiedCheckpoint.channel_values &&
        Object.keys(newVersions).length > 0
      ) {
        const filteredChannelValues: Record<string, unknown> = {};
        for (const channelName of Object.keys(newVersions)) {
          if (channelName in modifiedCheckpoint.channel_values) {
            filteredChannelValues[channelName] =
              modifiedCheckpoint.channel_values[channelName];
          }
        }
        modifiedCheckpoint.channel_values = filteredChannelValues;
      } else if (Object.keys(newVersions).length === 0) {
        // If newVersions is empty, store empty channel_values
        modifiedCheckpoint.channel_values = {};
      }

      const [[, serializedCheckpoint], [, serializedMetadata]] =
        await Promise.all([
          this.serde.dumpsTyped(modifiedCheckpoint),
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
        checkpointTs: checkpoint.ts,
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
      this.logger.debug(config);
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
