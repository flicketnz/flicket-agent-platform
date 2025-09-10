import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import { ModelProviderModule } from "../model-providers/model-provider.module";
import { ReactAgentModule } from "../react-agent";
import { SnowflakeCortexModule } from "../snowflake-agent/snowflake-agent.module";
import { GraphOrchestratorService } from "./services";

@Module({
  imports: [
    AgentsModule,
    ModelProviderModule,
    SnowflakeCortexModule,
    ReactAgentModule,
    LlmStorageModule,
  ],
  providers: [GraphOrchestratorService],
  exports: [GraphOrchestratorService],
})
export class OrchestrationModule {}
