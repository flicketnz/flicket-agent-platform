import * as Joi from "joi";

export const agentSnowflakeCortexSchema = Joi.object({
  AGENT_SNOWFLAKE_CORTEX_ENABLED: Joi.boolean().optional().default(false),
  AGENT_SNOWFLAKE_CORTEX_ENDPOINT: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Endpoint URL for Snowflake Cortex API"),
});
