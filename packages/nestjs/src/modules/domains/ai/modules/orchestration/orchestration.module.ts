import { Module } from "@nestjs/common";

import { AgentServicesModule } from "../agent-services/agent-services.module";
import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import { ModelProviderModule } from "../model-providers/model-provider.module";
import { ReactAgentModule } from "../react-agent";
import { SnowflakeCortexModule } from "../snowflake-agent/snowflake-agent.module";
import { GraphOrchestratorService } from "./services";

@Module({
  imports: [
    AgentServicesModule,
    ModelProviderModule,
    SnowflakeCortexModule,
    ReactAgentModule,
    LlmStorageModule,
  ],
  providers: [GraphOrchestratorService],
  exports: [GraphOrchestratorService],
})
export class OrchestrationModule {}
