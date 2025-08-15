import { registerAs } from "@nestjs/config";

export default registerAs("agent.snowflake-cortex", () => {
  return {
    enabled: Boolean(process.env.AGENT_SNOWFLAKE_CORTEX_ENABLED),
    endpoint: process.env.AGENT_SNOWFLAKE_CORTEX_ENDPOINT,
  };
});
