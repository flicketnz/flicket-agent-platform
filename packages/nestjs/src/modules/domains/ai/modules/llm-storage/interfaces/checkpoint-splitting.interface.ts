/**
 * Available splitting strategies
 */
export enum SplittingStrategy {
  /** Extract individual messages from channel_values into separate records */
  MESSAGE_LEVEL = "message_level",

  /** Base64 encode entire checkpoint and split into chunks */
  CONTENT_LEVEL = "content_level",
}

/**
 * Metadata for tracking split records
 */
export interface SplitRecordMetadata {
  /** Original record ID that was split */
  originalRecordId: string;

  /** Total number of parts this record was split into */
  totalParts: number;

  /** Current part number (1-based) */
  partNumber: number;

  /** Strategy used for splitting */
  strategy: SplittingStrategy;

  /** Timestamp when split was created */
  splitTimestamp: string;

  /** Checksum for data integrity verification */
  checksum?: string;

  /** Original size before splitting */
  originalSize: number;

  /** Size of this specific part */
  partSize: number;
}

/**
 * Structure for message-level split data
 */
export interface MessageSplitData {
  /** Channel name the messages belong to */
  channelName: string;

  /** Index of the first message in this part */
  startMessageIndex: number;

  /** Index of the last message in this part */
  endMessageIndex: number;

  /** Serialized messages data */
  messagesData: string;

  /** Metadata about the original checkpoint structure */
  checkpointMetadata: {
    totalMessages: number;
    channelVersion: string;
  };
}

/**
 * Structure for content-level split data
 */
export interface ContentSplitData {
  /** Base64 encoded chunk data */
  chunkData: string;

  /** Encoding used (always 'base64' for content-level) */
  encoding: "base64";
}

/**
 * Enhanced checkpoint record that supports splitting
 */
export interface SplitCheckpointRecord {
  /** Standard checkpoint fields */
  threadId: string;
  recordId: string;
  checkpoint?: string;
  metadata?: string;
  parentCheckpointId?: string;
  checkpointTs?: string;

  /** Split-specific fields */
  isSplit?: boolean;
  splitMetadata?: SplitRecordMetadata;
  messageSplitData?: MessageSplitData;
  contentSplitData?: ContentSplitData;

  /** Original fields for backwards compatibility */
  taskId?: string;
  channel?: string;
  value?: string;
  writeIdx?: number;
}

/**
 * Result of size analysis
 */
export interface SizeAnalysisResult {
  /** Total estimated size in bytes */
  totalSize: number;

  /** Whether the record exceeds the threshold */
  exceedsThreshold: boolean;

  /** Breakdown of size by component */
  sizeBreakdown: {
    checkpoint: number;
    metadata: number;
    overhead: number;
  };

  /** Estimated number of parts needed if splitting */
  estimatedParts: number;

  /** Largest component causing size issues */
  largestComponent: "checkpoint" | "metadata";

  /** Channel with the most messages (for message-level splitting) */
  largestChannel?: {
    name: string;
    messageCount: number;
    estimatedSize: number;
  };
}

/**
 * Options for reassembly operations
 */
export interface ReassemblyOptions {
  /** Whether to validate checksums during reassembly */
  validateChecksums: boolean;

  /** Maximum time to wait for all parts in milliseconds */
  timeout: number;

  /** Whether to log reassembly progress */
  enableLogging: boolean;
}

/**
 * Result of reassembly operation
 */
export interface ReassemblyResult<T = any> {
  /** Whether reassembly was successful */
  success: boolean;

  /** Reassembled data */
  data?: T;

  /** Any warnings encountered during reassembly */
  warnings: string[];

  /** Time taken for reassembly in milliseconds */
  reassemblyTime: number;

  /** Number of parts that were reassembled */
  partsReassembled: number;

  /** Total expected parts */
  totalExpectedParts: number;
}
