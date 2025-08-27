import Joi from "joi";

export const checkpointSplittingValidationSchema = Joi.object({
  CHECKPOINT_SPLITTING_ENABLED: Joi.boolean().default(false),
  CHECKPOINT_MAX_SIZE_THRESHOLD: Joi.number()
    .integer()
    .min(100000)
    .max(400000)
    .default(358400),
  CHECKPOINT_SPLITTING_STRATEGY: Joi.string()
    .valid("message_level", "content_level")
    .default("message_level"),
  CHECKPOINT_MAX_CHUNK_SIZE: Joi.number()
    .integer()
    .min(50000)
    .max(350000)
    .default(307200),
  CHECKPOINT_SIZE_MONITORING_ENABLED: Joi.boolean().default(true),
  CHECKPOINT_SPLIT_RECORD_PREFIX: Joi.string().default("split"),
  CHECKPOINT_SPLITTING_MAX_RETRIES: Joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(3),
  CHECKPOINT_OPERATION_TIMEOUT: Joi.number()
    .integer()
    .min(5000)
    .max(120000)
    .default(30000),
});
