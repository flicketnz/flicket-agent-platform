import { registerAs } from "@nestjs/config";

export default registerAs("agent.snowflake-cortex", () => {
  return {
    enabled: Boolean(process.env.AGENT_SNOWFLAKE_CORTEX_ENABLED),
    endpoint: process.env.AGENT_SNOWFLAKE_CORTEX_ENDPOINT,
    privateKey: process.env.AGENT_SNOWFLAKE_CORTEX_AUTH_PRIVATE_KEY,
    publicKeyFingerprint:
      process.env.AGENT_SNOWFLAKE_CORTEX_AUTH_PUBLIC_KEY_FINGERPRINT,
    user: process.env.AGENT_SNOWFLAKE_CORTEX_AUTH_USER,
    accountIdentifier:
      process.env.AGENT_SNOWFLAKE_CORTEX_AUTH_ACCOUNT_IDENTIFIER,

    // SQL execution configuration
    defaultDatabase: process.env.AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_DATABASE,
    defaultSchema: process.env.AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_SCHEMA,
    defaultWarehouse: process.env.AGENT_SNOWFLAKE_CORTEX_SQL_DEFAULT_WAREHOUSE,

    maxSqlExecutionTimeSeconds: Number.parseInt(
      String(process.env.AGENT_SNOWFLAKE_CORTEX_SQL_MAX_EXECUTION_TIME_SECONDS),
      10,
    ),
  };
});
