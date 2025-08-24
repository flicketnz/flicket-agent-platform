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
  AGENT_SNOWFLAKE_CORTEX_AUTH_PRIVATE_KEY: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Private key to sign JWT for rest api"),
  AGENT_SNOWFLAKE_CORTEX_AUTH_USER: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Snowflake user"),
  AGENT_SNOWFLAKE_CORTEX_AUTH_PUBLIC_KEY_FINGERPRINT: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Public key fingerprint associated with the user"),
  AGENT_SNOWFLAKE_CORTEX_AUTH_ACCOUNT_IDENTIFIER: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Snowflake account identifier"),

  AGENT_SNOWFLAKE_CORTEX_SQL_MAX_EXECUTION_TIME_SECONDS: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description(
      "Max time in seconds that the rest api to execute the SQL statement will run for",
    ),

  AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_WAREHOUSE: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required().default("COMPUTE_WH"),
      otherwise: Joi.string().optional(),
    })
    .description("Warehouse to run SQL Queries in"),

  AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_DATABASE: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Snowflake account identifier"),
  AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_SCHEMA: Joi.any()
    .when("AGENT_SNOWFLAKE_CORTEX_ENABLED", {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .description("Snowflake account identifier"),
});
