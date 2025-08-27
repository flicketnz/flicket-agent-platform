import { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import { Model } from "nestjs-dynamoose";
import checkpointSplittingConfig from "src/modules/config-management/configs/checkpoint-splitting.config";

import {
  ContentSplitData,
  MessageSplitData,
  ReassemblyOptions,
  ReassemblyResult,
  SplitCheckpointRecord,
  SplitRecordMetadata,
  SplittingStrategy,
} from "../interfaces/checkpoint-splitting.interface";
import { Checkpoints, CheckpointsKey } from "../schemas/checkpoints.interface";
import { CheckpointSizeService } from "./checkpoint-size.service";

/**
 * Service responsible for splitting and reassembling large checkpoint records
 */
@Injectable()
export class CheckpointSplittingService {
  private readonly logger = new Logger(CheckpointSplittingService.name);

  constructor(
    private readonly sizeService: CheckpointSizeService,
    @Inject(checkpointSplittingConfig.KEY)
    private readonly config: ConfigType<typeof checkpointSplittingConfig>,
  ) {}

  /**
   * Splits a checkpoint record if it exceeds size limits
   */
  async splitCheckpointIfNeeded(
    threadId: string,
    recordId: string,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    checkpointsModel: Model<Checkpoints, CheckpointsKey>,
  ): Promise<{ wasSplit: boolean; recordIds: string[] }> {
    const startTime = Date.now();

    try {
      if (!this.config.enabled) {
        return { wasSplit: false, recordIds: [recordId] };
      }

      // Analyze size to determine if splitting is needed
      const sizeAnalysis = this.sizeService.analyzeCheckpointSize(
        checkpoint,
        metadata,
      );

      if (!sizeAnalysis.exceedsThreshold) {
        this.logger.debug(
          `Checkpoint ${recordId} within size limits (${sizeAnalysis.totalSize} bytes)`,
        );
        return { wasSplit: false, recordIds: [recordId] };
      }

      this.logger.log(
        `Checkpoint ${recordId} exceeds size limit (${sizeAnalysis.totalSize}/${this.config.maxSizeThreshold} bytes), splitting...`,
      );

      // Validate that checkpoint can be split
      const canSplit = this.sizeService.canSplitCheckpoint(checkpoint);
      if (!canSplit.canSplit) {
        this.logger.warn(
          `Cannot split checkpoint ${recordId}: ${canSplit.reason}`,
        );
        return { wasSplit: false, recordIds: [recordId] };
      }

      // Perform splitting based on strategy
      const splitRecords = this._performSplit(
        threadId,
        recordId,
        checkpoint,
        metadata,
      );

      // Store split records with retry logic
      const recordIds = await this._storeSplitRecords(
        splitRecords,
        checkpointsModel,
      );

      const splitTime = Date.now() - startTime;
      this.logger.log(
        `Successfully split checkpoint ${recordId} into ${recordIds.length} parts in ${splitTime}ms`,
      );

      return { wasSplit: true, recordIds };
    } catch (error) {
      this.logger.error(`Failed to split checkpoint ${recordId}`, error);
      if (error instanceof Error) {
        throw new Error(`Checkpoint splitting failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Reassembles a split checkpoint record
   */
  async reassembleCheckpoint(
    threadId: string,
    recordId: string,
    checkpointsModel: Model<Checkpoints, CheckpointsKey>,
    options: ReassemblyOptions,
  ): Promise<
    ReassemblyResult<{ checkpoint: Checkpoint; metadata: CheckpointMetadata }>
  > {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      // Check if this is a split record
      const primaryRecord = await checkpointsModel.get({ threadId, recordId });
      if (!primaryRecord?.isSplit) {
        // Not a split record, return as-is
        return {
          success: false,
          warnings: ["Record is not split"],
          reassemblyTime: Date.now() - startTime,
          partsReassembled: 0,
          totalExpectedParts: 1,
        };
      }

      const splitMetadata = primaryRecord.splitMetadata!;

      // Gather all split parts
      const allParts = await this._gatherSplitParts(
        threadId,
        recordId,
        splitMetadata,
        checkpointsModel,
        options.timeout,
      );

      if (allParts.length !== splitMetadata.totalParts) {
        warnings.push(
          `Found ${allParts.length}/${splitMetadata.totalParts} parts`,
        );
      }

      // Reassemble based on strategy
      const reassembledData = this._performReassembly(
        allParts,
        splitMetadata.strategy,
        options.validateChecksums,
      );

      if (options.enableLogging) {
        this.logger.log(
          `Reassembled checkpoint ${recordId} from ${allParts.length} parts`,
        );
      }

      return {
        success: true,
        data: reassembledData,
        warnings,
        reassemblyTime: Date.now() - startTime,
        partsReassembled: allParts.length,
        totalExpectedParts: splitMetadata.totalParts,
      };
    } catch (error) {
      this.logger.error(`Failed to reassemble checkpoint ${recordId}`, error);
      if (error instanceof Error) {
        return {
          success: false,
          warnings: [`Reassembly failed: ${error.message}`],
          reassemblyTime: Date.now() - startTime,
          partsReassembled: 0,
          totalExpectedParts: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Performs the actual splitting based on the configured strategy
   */
  private _performSplit(
    threadId: string,
    recordId: string,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): SplitCheckpointRecord[] {
    switch (this.config.strategy) {
      case SplittingStrategy.MESSAGE_LEVEL:
        return this._splitMessageLevel(
          threadId,
          recordId,
          checkpoint,
          metadata,
        );

      case SplittingStrategy.CONTENT_LEVEL:
        return this._splitContentLevel(
          threadId,
          recordId,
          checkpoint,
          metadata,
        );

      default:
        throw new Error(
          `Unknown splitting strategy: ${this.config.strategy as string}`,
        );
    }
  }

  /**
   * Splits checkpoint at message level
   */
  private _splitMessageLevel(
    threadId: string,
    recordId: string,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): SplitCheckpointRecord[] {
    const records: SplitCheckpointRecord[] = [];
    const timestamp = new Date().toISOString();
    let partNumber = 1;

    // Create primary record with checkpoint structure but without messages
    const primaryCheckpoint = { ...checkpoint };
    const cleanedChannelValues: Record<string, any> = {};

    // Process each channel
    for (const [channelName, channelValue] of Object.entries(
      checkpoint.channel_values || {},
    )) {
      if (
        channelValue &&
        typeof channelValue === "object" &&
        "messages" in channelValue
      ) {
        const messages = channelValue.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          // Split messages into chunks
          const messageChunks = this._chunkMessages(
            messages,
            this.config.maxChunkSize,
          );

          for (
            let chunkIndex = 0;
            chunkIndex < messageChunks.length;
            chunkIndex++
          ) {
            const chunk = messageChunks[chunkIndex];
            const messageSplitData: MessageSplitData = {
              channelName,
              startMessageIndex:
                chunkIndex * Math.ceil(messages.length / messageChunks.length),
              endMessageIndex: Math.min(
                (chunkIndex + 1) *
                  Math.ceil(messages.length / messageChunks.length) -
                  1,
                messages.length - 1,
              ),
              messagesData: JSON.stringify(chunk),
              checkpointMetadata: {
                totalMessages: messages.length,
                channelVersion: String(
                  checkpoint.channel_versions?.[channelName] || "1",
                ),
              },
            };

            const splitRecord: SplitCheckpointRecord = {
              threadId,
              recordId: this._generateSplitRecordId(
                recordId,
                partNumber,
                this.config.splitRecordPrefix,
              ),
              isSplit: true,
              splitMetadata: {
                originalRecordId: recordId,
                totalParts: 0, // Will be updated after all parts are created
                partNumber: partNumber++,
                strategy: SplittingStrategy.MESSAGE_LEVEL,
                splitTimestamp: timestamp,
                originalSize: 0, // Will be calculated
                partSize: new TextEncoder().encode(
                  messageSplitData.messagesData,
                ).length,
              },
              messageSplitData,
            };

            records.push(splitRecord);
          }

          // Store channel without messages
          cleanedChannelValues[channelName] = {
            ...channelValue,
            messages: [], // Empty messages array as placeholder
          };
        } else {
          cleanedChannelValues[channelName] = channelValue;
        }
      } else {
        cleanedChannelValues[channelName] = channelValue;
      }
    }

    primaryCheckpoint.channel_values = cleanedChannelValues;

    // Create primary record
    const serializedCheckpoint = JSON.stringify(primaryCheckpoint);
    const serializedMetadata = JSON.stringify(metadata);
    const originalSize = new TextEncoder().encode(
      serializedCheckpoint + serializedMetadata,
    ).length;

    const primaryRecord: SplitCheckpointRecord = {
      threadId,
      recordId,
      checkpoint: serializedCheckpoint,
      metadata: serializedMetadata,
      isSplit: true,
      splitMetadata: {
        originalRecordId: recordId,
        totalParts: records.length + 1,
        partNumber: 0, // Primary record
        strategy: SplittingStrategy.MESSAGE_LEVEL,
        splitTimestamp: timestamp,
        originalSize,
        partSize: new TextEncoder().encode(
          serializedCheckpoint + serializedMetadata,
        ).length,
        checksum: this.sizeService.calculateChecksum(
          serializedCheckpoint + serializedMetadata,
        ),
      },
    };

    // Update total parts in all records
    [primaryRecord, ...records].forEach((record) => {
      record.splitMetadata!.totalParts = records.length + 1;
      record.splitMetadata!.originalSize = originalSize;
    });

    return [primaryRecord, ...records];
  }

  /**
   * Splits checkpoint at content level using Base64 chunking
   */
  private _splitContentLevel(
    threadId: string,
    recordId: string,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): SplitCheckpointRecord[] {
    const records: SplitCheckpointRecord[] = [];
    const timestamp = new Date().toISOString();

    // Serialize the entire checkpoint and metadata
    const fullData = JSON.stringify({ checkpoint, metadata });
    const base64Data = Buffer.from(fullData, "utf8").toString("base64");
    const originalSize = new TextEncoder().encode(fullData).length;

    // Split into chunks
    const chunks = this._chunkString(base64Data, this.config.maxChunkSize);

    for (let i = 0; i < chunks.length; i++) {
      const contentSplitData: ContentSplitData = {
        chunkData: chunks[i],
        encoding: "base64",
      };

      const splitRecord: SplitCheckpointRecord = {
        threadId,
        recordId:
          i === 0
            ? recordId
            : this._generateSplitRecordId(
                recordId,
                i + 1,
                this.config.splitRecordPrefix,
              ),
        isSplit: true,
        splitMetadata: {
          originalRecordId: recordId,
          totalParts: chunks.length,
          partNumber: i + 1,
          strategy: SplittingStrategy.CONTENT_LEVEL,
          splitTimestamp: timestamp,
          originalSize,
          partSize: new TextEncoder().encode(chunks[i]).length,
          checksum: this.sizeService.calculateChecksum(chunks[i]),
        },
        contentSplitData,
      };

      records.push(splitRecord);
    }

    return records;
  }

  /**
   * Chunks messages into smaller groups
   */
  private _chunkMessages(messages: any[], maxChunkSize: number): any[][] {
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentSize = 0;

    for (const message of messages) {
      const messageSize = new TextEncoder().encode(
        JSON.stringify(message),
      ).length;

      if (currentSize + messageSize > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [message];
        currentSize = messageSize;
      } else {
        currentChunk.push(message);
        currentSize += messageSize;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Chunks a string into smaller pieces
   */
  private _chunkString(str: string, maxChunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += maxChunkSize) {
      chunks.push(str.substring(i, i + maxChunkSize));
    }
    return chunks;
  }

  /**
   * Generates a unique record ID for split parts
   */
  private _generateSplitRecordId(
    originalRecordId: string,
    partNumber: number,
    prefix: string,
  ): string {
    return `${prefix}#${originalRecordId}#part#${partNumber.toString().padStart(4, "0")}`;
  }

  /**
   * Stores split records with retry logic
   */
  private async _storeSplitRecords(
    records: SplitCheckpointRecord[],
    checkpointsModel: Model<Checkpoints, CheckpointsKey>,
  ): Promise<string[]> {
    const recordIds: string[] = [];
    const errors: Error[] = [];

    for (const record of records) {
      let retries = 0;
      let stored = false;

      while (retries < this.config.maxRetries && !stored) {
        try {
          await checkpointsModel.create(record);
          recordIds.push(record.recordId);
          stored = true;
        } catch (error) {
          retries++;
          errors.push(error as Error);

          if (retries < this.config.maxRetries) {
            await this._delay(Math.pow(2, retries) * 100); // Exponential backoff
          }
        }
      }

      if (!stored) {
        // Rollback: delete already stored records
        await this._rollbackStoredRecords(
          recordIds,
          checkpointsModel,
          record.threadId,
        );
        throw new Error(
          `Failed to store split record after ${this.config.maxRetries} retries: ${errors[errors.length - 1].message}`,
        );
      }
    }

    return recordIds;
  }

  /**
   * Gathers all parts of a split record
   */
  private async _gatherSplitParts(
    threadId: string,
    recordId: string,
    splitMetadata: SplitRecordMetadata,
    checkpointsModel: Model<Checkpoints, CheckpointsKey>,
    timeout: number,
  ): Promise<SplitCheckpointRecord[]> {
    const endTime = Date.now() + timeout;
    const parts: SplitCheckpointRecord[] = [];

    // Get primary record
    const primaryRecord = await checkpointsModel.get({ threadId, recordId });
    if (primaryRecord) {
      parts.push(primaryRecord as SplitCheckpointRecord);
    }

    // Get all split parts
    for (let partNum = 1; partNum < splitMetadata.totalParts; partNum++) {
      if (Date.now() > endTime) {
        throw new Error(`Timeout while gathering split parts (${timeout}ms)`);
      }

      const partRecordId = this._generateSplitRecordId(
        recordId,
        partNum,
        "split",
      );
      try {
        const partRecord = await checkpointsModel.get({
          threadId,
          recordId: partRecordId,
        });
        if (partRecord) {
          parts.push(partRecord as SplitCheckpointRecord);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get split part ${partNum} for record ${recordId}`,
          error,
        );
      }
    }

    return parts.sort(
      (a, b) =>
        (a.splitMetadata?.partNumber || 0) - (b.splitMetadata?.partNumber || 0),
    );
  }

  /**
   * Performs reassembly based on strategy
   */
  private _performReassembly(
    parts: SplitCheckpointRecord[],
    strategy: SplittingStrategy,
    validateChecksums: boolean,
  ): { checkpoint: Checkpoint; metadata: CheckpointMetadata } {
    switch (strategy) {
      case SplittingStrategy.MESSAGE_LEVEL:
        return this._reassembleMessageLevel(parts, validateChecksums);

      case SplittingStrategy.CONTENT_LEVEL:
        return this._reassembleContentLevel(parts, validateChecksums);

      default:
        throw new Error(`Unknown reassembly strategy: ${strategy as string}`);
    }
  }

  /**
   * Reassembles message-level split
   */
  private _reassembleMessageLevel(
    parts: SplitCheckpointRecord[],
    validateChecksums: boolean,
  ): { checkpoint: Checkpoint; metadata: CheckpointMetadata } {
    const primaryPart = parts.find((p) => p.splitMetadata?.partNumber === 0);
    if (!primaryPart?.checkpoint || !primaryPart?.metadata) {
      throw new Error("Primary part not found or incomplete");
    }

    const checkpoint = JSON.parse(primaryPart.checkpoint) as Checkpoint;
    const metadata = JSON.parse(primaryPart.metadata) as CheckpointMetadata;

    // Reassemble messages by channel
    const messagesByChannel: Record<string, any[]> = {};

    for (const part of parts) {
      if (part.messageSplitData && part.splitMetadata?.partNumber !== 0) {
        const { channelName, messagesData } = part.messageSplitData;

        if (validateChecksums && part.splitMetadata?.checksum) {
          const calculatedChecksum =
            this.sizeService.calculateChecksum(messagesData);
          if (calculatedChecksum !== part.splitMetadata.checksum) {
            throw new Error(
              `Checksum mismatch for part ${part.splitMetadata.partNumber}`,
            );
          }
        }

        const messages = JSON.parse(messagesData) as any[];
        if (!messagesByChannel[channelName]) {
          messagesByChannel[channelName] = [];
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        messagesByChannel[channelName].push(...messages);
      }
    }

    // Restore messages to channels
    if (checkpoint.channel_values) {
      for (const [channelName, messages] of Object.entries(messagesByChannel)) {
        if (
          checkpoint.channel_values[channelName] &&
          typeof checkpoint.channel_values[channelName] === "object"
        ) {
          (
            checkpoint.channel_values[channelName] as Record<string, unknown>
          ).messages = messages;
        }
      }
    }

    return { checkpoint, metadata };
  }

  /**
   * Reassembles content-level split
   */
  private _reassembleContentLevel(
    parts: SplitCheckpointRecord[],
    validateChecksums: boolean,
  ): { checkpoint: Checkpoint; metadata: CheckpointMetadata } {
    // Sort parts by part number
    const sortedParts = parts.sort(
      (a, b) =>
        (a.splitMetadata?.partNumber || 0) - (b.splitMetadata?.partNumber || 0),
    );

    let reassembledBase64 = "";

    for (const part of sortedParts) {
      if (!part.contentSplitData?.chunkData) {
        throw new Error(
          `Part ${part.splitMetadata?.partNumber} missing chunk data`,
        );
      }

      if (validateChecksums && part.splitMetadata?.checksum) {
        const calculatedChecksum = this.sizeService.calculateChecksum(
          part.contentSplitData.chunkData,
        );
        if (calculatedChecksum !== part.splitMetadata.checksum) {
          throw new Error(
            `Checksum mismatch for part ${part.splitMetadata.partNumber}`,
          );
        }
      }

      reassembledBase64 += part.contentSplitData.chunkData;
    }

    // Decode and parse
    const decodedData = Buffer.from(reassembledBase64, "base64").toString(
      "utf8",
    );
    const { checkpoint, metadata } = JSON.parse(decodedData) as {
      checkpoint: Checkpoint<string, string>;
      metadata: CheckpointMetadata;
    };

    return { checkpoint, metadata };
  }

  /**
   * Rollback stored records in case of failure
   */
  private async _rollbackStoredRecords(
    recordIds: string[],
    checkpointsModel: Model<Checkpoints, CheckpointsKey>,
    threadId: string,
  ): Promise<void> {
    for (const recordId of recordIds) {
      try {
        await checkpointsModel.delete({ threadId, recordId });
      } catch (error) {
        this.logger.warn(`Failed to rollback record ${recordId}`, error);
      }
    }
  }

  /**
   * Simple delay utility
   */
  private _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
