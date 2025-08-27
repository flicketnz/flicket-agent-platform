import { createHash } from "node:crypto";

import { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import checkpointSplittingConfig from "src/modules/config-management/configs/checkpoint-splitting.config";

import {
  SizeAnalysisResult,
  SplittingStrategy,
} from "../interfaces/checkpoint-splitting.interface";

/**
 * Service responsible for analyzing checkpoint sizes and determining
 * if splitting is required
 */
@Injectable()
export class CheckpointSizeService {
  private readonly logger = new Logger(CheckpointSizeService.name);

  // DynamoDB overhead: hash key + range key + other attributes
  private static readonly DYNAMODB_OVERHEAD_BYTES = 1024; // Conservative estimate

  // Base64 encoding overhead (33% increase)
  private static readonly BASE64_OVERHEAD_FACTOR = 1.33;

  constructor(
    @Inject(checkpointSplittingConfig.KEY)
    private config: ConfigType<typeof checkpointSplittingConfig>,
  ) {}

  /**
   * Analyzes the size of a checkpoint and determines if splitting is needed
   */
  analyzeCheckpointSize(
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): SizeAnalysisResult {
    const startTime = Date.now();

    try {
      // Calculate size of each component
      const checkpointSize = this._calculateDataSize(checkpoint);
      const metadataSize = this._calculateDataSize(metadata);
      const overheadSize = CheckpointSizeService.DYNAMODB_OVERHEAD_BYTES;

      const totalSize = checkpointSize + metadataSize + overheadSize;
      const exceedsThreshold = totalSize > this.config.maxSizeThreshold;

      // Analyze message distribution for message-level splitting
      const largestChannel = this._findLargestChannel(checkpoint);

      // Estimate parts needed based on strategy
      const estimatedParts = this._estimatePartsNeeded(totalSize, checkpoint);

      const result: SizeAnalysisResult = {
        totalSize,
        exceedsThreshold,
        sizeBreakdown: {
          checkpoint: checkpointSize,
          metadata: metadataSize,
          overhead: overheadSize,
        },
        estimatedParts,
        largestComponent:
          checkpointSize > metadataSize ? "checkpoint" : "metadata",
        largestChannel,
      };

      if (this.config.enableSizeMonitoring) {
        this.logger.log(
          `Size analysis completed in ${Date.now() - startTime}ms`,
          {
            totalSize,
            exceedsThreshold,
            estimatedParts,
            largestChannel: largestChannel?.name,
          },
        );
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to analyze checkpoint size", error);
      if (error instanceof Error) {
        throw new Error(`Size analysis failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Calculates the estimated size of data when serialized
   */
  private _calculateDataSize(data: any): number {
    try {
      // Serialize to JSON to get accurate size
      const jsonString = JSON.stringify(data);

      // Account for UTF-8 encoding (most characters are 1 byte, some are more)
      const utf8Size = new TextEncoder().encode(jsonString).length;

      // Account for Base64 encoding overhead when stored
      const base64Size = Math.ceil(
        utf8Size * CheckpointSizeService.BASE64_OVERHEAD_FACTOR,
      );

      return base64Size;
    } catch (error) {
      this.logger.warn(
        "Failed to calculate data size, using fallback estimation",
        error,
      );
      // Fallback: rough estimation based on string length
      return JSON.stringify(data).length * 2;
    }
  }

  /**
   * Finds the channel with the most messages for potential message-level splitting
   */
  private _findLargestChannel(
    checkpoint: Checkpoint,
  ): SizeAnalysisResult["largestChannel"] {
    if (!checkpoint.channel_values) {
      return undefined;
    }

    let largestChannel: SizeAnalysisResult["largestChannel"];
    let maxSize = 0;

    for (const [channelName, channelValue] of Object.entries(
      checkpoint.channel_values,
    )) {
      if (
        channelValue &&
        typeof channelValue === "object" &&
        "messages" in channelValue
      ) {
        const messages = channelValue.messages;
        if (Array.isArray(messages)) {
          const channelSize = this._calculateDataSize(messages);

          if (channelSize > maxSize) {
            maxSize = channelSize;
            largestChannel = {
              name: channelName,
              messageCount: messages.length,
              estimatedSize: channelSize,
            };
          }
        }
      }
    }

    return largestChannel;
  }

  /**
   * Estimates the number of parts needed for splitting based on strategy
   */
  private _estimatePartsNeeded(
    totalSize: number,
    checkpoint: Checkpoint,
  ): number {
    switch (this.config.strategy) {
      case SplittingStrategy.CONTENT_LEVEL:
        return Math.ceil(totalSize / this.config.maxChunkSize);

      case SplittingStrategy.MESSAGE_LEVEL:
        return this._estimateMessageLevelParts(
          checkpoint,
          this.config.maxChunkSize,
        );

      default:
        return 1;
    }
  }

  /**
   * Estimates parts needed for message-level splitting
   */
  private _estimateMessageLevelParts(
    checkpoint: Checkpoint,
    maxChunkSize: number,
  ): number {
    if (!checkpoint.channel_values) {
      return 1;
    }

    let totalParts = 1; // Base checkpoint without messages

    for (const [channelName, channelValue] of Object.entries(
      checkpoint.channel_values,
    )) {
      if (
        channelValue &&
        typeof channelValue === "object" &&
        "messages" in channelValue
      ) {
        const messages = channelValue.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          const channelSize = this._calculateDataSize(messages);
          const channelParts = Math.ceil(channelSize / maxChunkSize);
          totalParts += channelParts;
        }
      }
    }

    return totalParts;
  }

  /**
   * Validates if a checkpoint can be safely split using the specified strategy
   */
  canSplitCheckpoint(checkpoint: Checkpoint): {
    canSplit: boolean;
    reason?: string;
  } {
    try {
      switch (this.config.strategy) {
        case SplittingStrategy.MESSAGE_LEVEL:
          return this._canSplitMessageLevel(checkpoint);

        case SplittingStrategy.CONTENT_LEVEL:
          return { canSplit: true }; // Content-level can always split

        default:
          return { canSplit: false, reason: "Unknown splitting strategy" };
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          canSplit: false,
          reason: `Validation failed: ${error.message}`,
        };
      }
      throw error;
    }
  }

  /**
   * Validates if checkpoint can be split at message level
   */
  private _canSplitMessageLevel(checkpoint: Checkpoint): {
    canSplit: boolean;
    reason?: string;
  } {
    if (!checkpoint.channel_values) {
      return { canSplit: false, reason: "No channel values found" };
    }

    let hasMessages = false;

    for (const [channelName, channelValue] of Object.entries(
      checkpoint.channel_values,
    )) {
      if (
        channelValue &&
        typeof channelValue === "object" &&
        "messages" in channelValue
      ) {
        const messages = channelValue.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          hasMessages = true;

          // Check if messages can be safely split (each message should be serializable)
          for (let i = 0; i < Math.min(messages.length, 5); i++) {
            // Sample first 5
            try {
              JSON.stringify(messages[i]);
            } catch (error) {
              return {
                canSplit: false,
                reason: `Message ${i} in channel ${channelName} is not serializable`,
              };
            }
          }
        }
      }
    }

    if (!hasMessages) {
      return { canSplit: false, reason: "No messages found to split" };
    }

    return { canSplit: true };
  }

  /**
   * Calculates checksum for data integrity verification
   */
  calculateChecksum(data: string): string {
    // Simple checksum using built-in crypto (Node.js)

    return createHash("sha256").update(data).digest("hex").substring(0, 16);
  }

  /**
   * Estimates the size reduction from splitting
   */
  estimateSizeReduction(
    originalSize: number,
    strategy: SplittingStrategy,
    parts: number,
  ): { reducedSize: number; overheadIncrease: number; netReduction: number } {
    // Each part has its own DynamoDB overhead
    const overheadIncrease =
      (parts - 1) * CheckpointSizeService.DYNAMODB_OVERHEAD_BYTES;

    // Additional metadata overhead per part
    const metadataOverhead = parts * 200; // Estimated metadata per part

    const totalOverhead = overheadIncrease + metadataOverhead;
    const reducedSize = originalSize / parts;
    const netReduction = originalSize - (reducedSize + totalOverhead);

    return {
      reducedSize,
      overheadIncrease: totalOverhead,
      netReduction,
    };
  }
}
