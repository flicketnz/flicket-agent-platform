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
  };
});
