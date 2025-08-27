import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import Joi from "joi";

import agentSnowflakeCortexConfig from "./configs/agent-snowflake-cortex.config";
import awsConfig from "./configs/aws.config";
import checkpointSplittingConfig from "./configs/checkpoint-splitting.config";
import jwtConfig from "./configs/jwt.config";
import llmConfig from "./configs/llm.config";
import llmOpenaiConfig from "./configs/llm-openai.config";
import llmToolsSearxngConfig from "./configs/llm-tools-searxng.config";
import llmToolsSlackConfig from "./configs/llm-tools-slack.config";
import slackConfig from "./configs/slack.config";
import { agentSnowflakeCortexSchema } from "./schemas/agent-snowflake-cortex.schema";
import { awsValidationSchema } from "./schemas/aws.schema";
import { checkpointSplittingValidationSchema } from "./schemas/checkpoint-splitting.schema";
import { commonValidationSchema } from "./schemas/common.schema";
import { jwtValidationSchema } from "./schemas/jwt.schema";
import { llmValidationSchema } from "./schemas/llm.schema";
import { llmOpenAiValidationSchema } from "./schemas/llm-openai.schema";
import { llmToolsSearxngValidationSchema } from "./schemas/llm-tools-searxng.schema";
import { llmToolsSlackValidationSchema } from "./schemas/llm-tools-slack.schema";
import { slackValidationSchema } from "./schemas/slack.schema";

@Module({
  imports: [
    ConfigModule.forRoot({
      expandVariables: true,
      validationSchema: Joi.any()
        .concat(agentSnowflakeCortexSchema)
        .concat(awsValidationSchema)
        .concat(checkpointSplittingValidationSchema)
        .concat(commonValidationSchema)
        .concat(jwtValidationSchema)
        .concat(llmValidationSchema)
        .concat(llmOpenAiValidationSchema)
        .concat(llmToolsSearxngValidationSchema)
        .concat(llmToolsSlackValidationSchema)
        .concat(slackValidationSchema),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      load: [
        agentSnowflakeCortexConfig,
        awsConfig,
        checkpointSplittingConfig,
        jwtConfig,
        llmConfig,
        llmOpenaiConfig,
        llmToolsSearxngConfig,
        llmToolsSlackConfig,
        slackConfig,
      ],
    }),
  ],
})
export class ConfigManagementModule {}
