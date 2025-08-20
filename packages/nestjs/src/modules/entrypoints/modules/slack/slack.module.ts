import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { SlackModule } from "nestjs-slack-bolt";
import slackConfig from "src/modules/config-management/configs/slack.config";

import { SlackEntrypointController } from "./slack.controller";
import { SlackReceiverController } from "./slack-receiver.controller";

@Module({
  imports: [
    ConfigModule.forFeature(slackConfig),
    SlackModule.forRootAsync({
      imports: [ConfigModule.forFeature(slackConfig)],
      inject: [slackConfig.KEY, ModuleRef],
      useFactory: (config: ConfigType<typeof slackConfig>) => {
        const receiver = config.socketMode
          ? undefined
          : {
              init: () => {},

              start: (...args: any[]) => {
                return Promise.resolve();
              },
              stop: (...args: any[]) => {
                return Promise.resolve();
              },
            };
        return {
          appToken: config.appToken,
          socketMode: config.socketMode,
          signingSecret: config.signingSecret,
          token: config.botToken,
          logLevel: config.logLevel,
          tokenVerificationEnabled: false,
          receiver,
        };
      },
    }),
  ],

  controllers: [SlackEntrypointController, SlackReceiverController],
})
export class SlackEntryPointModule {}
