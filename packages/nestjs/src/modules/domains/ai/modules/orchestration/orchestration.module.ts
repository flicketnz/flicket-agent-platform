import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import { ModelProviderModule } from "../model-providers/model-provider.module";
import { SnowflakeCortexModule } from "../snowflake-agent/snowflake-cortex.module";
import { GraphOrchestratorService } from "./services";

@Module({
  imports: [
    AgentsModule,
    ModelProviderModule,
    SnowflakeCortexModule,
    LlmStorageModule,
  ],
  providers: [GraphOrchestratorService],
  exports: [GraphOrchestratorService],
})
export class OrchestrationModule {}
