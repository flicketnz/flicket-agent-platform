import * as Joi from "joi";

export const agentSnowflakeCortexSchema = Joi.object({
  AGENT_SNOWFLAKE_CORTEX_ENABLED: Joi.boolean().optional().default(false),
});
