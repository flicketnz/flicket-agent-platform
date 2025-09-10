import * as Joi from "joi";

export const llmBedrockConverseValidationSchema = Joi.object({
  LLM_BEDROCK_CONVERSE_MODEL: Joi.any().when("LLM_PRIMARY_PROVIDER", {
    is: "BEDROCK_CONVERSE",
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  LLM_BEDROCK_CONVERSE_REGION: Joi.any()
    .when("LLM_PRIMARY_PROVIDER", {
      is: "BEDROCK_CONVERSE",
      then: Joi.string().optional(),
      otherwise: Joi.string().optional(),
    })
    .description(
      "If set, this region is used when connecting to bedrock. If not set, then will fallback and use AWS_DEFAULT_REGION",
    ),
  LLM_BEDROCK_CONVERSE_TEMP: Joi.number().min(0.0).max(1.0).default(0.1),
});
