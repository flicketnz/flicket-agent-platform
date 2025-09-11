import * as Joi from "joi";

export const snowflakeSchema = Joi.object({
  SNOWFLAKE_ENDPOINT: Joi.string()
    .required()
    .description("Endpoint URL for Snowflake Cortex API"),
  SNOWFLAKE_AUTH_PRIVATE_KEY: Joi.string()
    .required()
    .description("Private key to sign JWT for rest api"),
  SNOWFLAKE_AUTH_USER: Joi.string().required().description("Snowflake user"),
  SNOWFLAKE_AUTH_PUBLIC_KEY_FINGERPRINT: Joi.string()
    .required()
    .description("Public key fingerprint associated with the user"),
  SNOWFLAKE_AUTH_ACCOUNT_IDENTIFIER: Joi.string()
    .required()
    .description("Snowflake account identifier"),

  SNOWFLAKE_SQL_MAX_EXECUTION_TIME_SECONDS: Joi.string()
    .required()
    .description(
      "Max time in seconds that the rest api to execute the SQL statement will run for",
    ),

  SNOWFLAKE_SQL_DEFAULT_WAREHOUSE: Joi.string()
    .required()
    .default("COMPUTE_WH")
    .description("Default Warehouse to run SQL Queries in"),

  SNOWFLAKE_SQL_DEFAULT_DATABASE: Joi.string()
    .required()
    .description("Snowflake default database"),
  SNOWFLAKE_SQL_DEFAULT_SCHEMA: Joi.string()
    .required()
    .description("Snowflake account identifier"),
});
