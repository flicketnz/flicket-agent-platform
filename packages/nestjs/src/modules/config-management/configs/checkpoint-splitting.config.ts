import { registerAs } from "@nestjs/config";

import { SplittingStrategy } from "../../domains/ai/modules/llm-storage/interfaces/checkpoint-splitting.interface";

export default registerAs("checkpointSplitting", () => ({
  enabled: process.env.CHECKPOINT_SPLITTING_ENABLED === "true" || false,
  maxSizeThreshold: parseInt(
    process.env.CHECKPOINT_MAX_SIZE_THRESHOLD || "358400",
    10,
  ), // 350KB
  strategy:
    (process.env.CHECKPOINT_SPLITTING_STRATEGY as SplittingStrategy) ||
    SplittingStrategy.MESSAGE_LEVEL,
  maxChunkSize: parseInt(process.env.CHECKPOINT_MAX_CHUNK_SIZE || "307200", 10), // 300KB
  enableSizeMonitoring:
    process.env.CHECKPOINT_SIZE_MONITORING_ENABLED === "true" || true,
  splitRecordPrefix: process.env.CHECKPOINT_SPLIT_RECORD_PREFIX || "split",
  maxRetries: parseInt(process.env.CHECKPOINT_SPLITTING_MAX_RETRIES || "3", 10),
  operationTimeout: parseInt(
    process.env.CHECKPOINT_OPERATION_TIMEOUT || "30000",
    10,
  ), // 30 seconds
}));
