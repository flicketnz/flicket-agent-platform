import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { SnowflakeCortexAgentAdapter } from "./adapters";

@Module({
  imports: [ConfigModule.forFeature(agentSnowflakeCortexConfig)],
  providers: [
    {
      provide: SnowflakeCortexAgentAdapter,
      inject: [agentSnowflakeCortexConfig.KEY],
      // TODO: test this enabled statement works
      useFactory: (config: ConfigType<typeof agentSnowflakeCortexConfig>) => {
        if (!config.enabled) {
          return null;
        }
        return SnowflakeCortexAgentAdapter;
      },
    },
  ],
  exports: [],
})
export class AiAgentsModule {}
