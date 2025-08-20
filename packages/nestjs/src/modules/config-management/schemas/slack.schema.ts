import * as Joi from "joi";

export const slackValidationSchema = Joi.object({
  SLACK_LOG_LEVEL: Joi.string()
    .valid("debug", "info", "warn", "error")
    .optional()
    .default("info"),
  SLACK_BOT_TOKEN: Joi.string().required(),
  SLACK_SIGNING_SECRET: Joi.any().when("SLACK_SOCKET_MODE", {
    is: false,
    then: Joi.string().required(),
    otherwise: Joi.disallow(),
  }),
  SLACK_APP_TOKEN: Joi.any().when("SLACK_SOCKET_MODE", {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.disallow(),
  }),
  SLACK_SOCKET_MODE: Joi.boolean()
    .description(
      "When true, runs app with socket connections to slack instead of http endpoints",
    )
    .default(false),
});
