import { registerAs } from "@nestjs/config";
import { LogLevel } from "@slack/bolt";

export default registerAs("slack", () => {
  return {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: process.env.SLACK_SOCKET_MODE === "true",
    logLevel: process.env.SLACK_LOG_LEVEL as LogLevel,
  };
});
