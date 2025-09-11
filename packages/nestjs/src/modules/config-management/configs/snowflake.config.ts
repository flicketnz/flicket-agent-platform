import { registerAs } from "@nestjs/config";

export default registerAs("snowflake", () => {
  return {
    endpoint: process.env.SNOWFLAKE_ENDPOINT,
    privateKey: process.env.SNOWFLAKE_AUTH_PRIVATE_KEY,
    publicKeyFingerprint: process.env.SNOWFLAKE_AUTH_PUBLIC_KEY_FINGERPRINT,
    user: process.env.SNOWFLAKE_AUTH_USER,
    accountIdentifier: process.env.SNOWFLAKE_AUTH_ACCOUNT_IDENTIFIER,

    // SQL execution configuration
    defaultDatabase: process.env.SNOWFLAKE_SQL_DEFAULT_DATABASE,
    defaultSchema: process.env.SNOWFLAKE_SQL_DEFAULT_SCHEMA,
    defaultWarehouse: process.env.SNOWFLAKE_SQL_DEFAULT_WAREHOUSE,

    maxSqlExecutionTimeSeconds: Number.parseInt(
      String(process.env.SNOWFLAKE_SQL_MAX_EXECUTION_TIME_SECONDS),
      10,
    ),
  };
});
