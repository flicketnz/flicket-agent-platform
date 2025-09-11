import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { AuthModule } from "src/modules/auth";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";
import snowflakeConfig from "src/modules/config-management/configs/snowflake.config";

import { SnowflakeUtilsModule } from "../../../../snowflake-utils/snowflake-utils.module";
import { SnowflakeCortexAgentAdapter } from "./adapters/snowflake-cortex.agent";
import { CortexController } from "./controllers";

@Module({
  imports: [
    ConfigModule.forFeature(snowflakeConfig),
    ConfigModule.forFeature(agentSnowflakeCortexConfig),
    AuthModule,
    SnowflakeUtilsModule,
  ],
  providers: [
    {
      provide: SnowflakeCortexAgentAdapter,
      inject: [agentSnowflakeCortexConfig.KEY, ModuleRef],
      useFactory: (
        config: ConfigType<typeof agentSnowflakeCortexConfig>,
        moduleRef: ModuleRef,
      ) => {
        if (!config.enabled) {
          return null;
        }
        return moduleRef.create<SnowflakeCortexAgentAdapter>(
          SnowflakeCortexAgentAdapter,
        );
      },
    },
  ],
  exports: [SnowflakeCortexAgentAdapter],
  // TODO: this controller is here until i move it to an proper entrypoint module
  controllers: [CortexController],
})
export class SnowflakeCortexModule {}
