import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { DiscoveryModule, ModuleRef } from "@nestjs/core";
import { AuthModule } from "src/modules/auth/auth.module";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import {
  LangGraphReactAgentAdapter,
  SnowflakeCortexAgentAdapter,
} from "./adapters";
import { CortexController } from "./controllers";
import { AgentRegistryService } from "./services";

@Module({
  imports: [
    HttpModule,
    ConfigModule.forFeature(agentSnowflakeCortexConfig),
    DiscoveryModule,
    LlmStorageModule,
    AuthModule,
  ],
  controllers: [CortexController],
  providers: [
    LangGraphReactAgentAdapter,
    {
      provide: SnowflakeCortexAgentAdapter,
      inject: [agentSnowflakeCortexConfig.KEY, ModuleRef],
      // TODO: test this enabled statement works
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
    AgentRegistryService,
  ],
  exports: [
    AgentRegistryService,
    LangGraphReactAgentAdapter,
    SnowflakeCortexAgentAdapter,
  ],
})
export class AgentsModule {}
