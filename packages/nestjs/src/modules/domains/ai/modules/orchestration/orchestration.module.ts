import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { ModelProviderModule } from "../model-providers/model-provider.module";
import { AgentOrchestratorService } from "./services";

@Module({
  imports: [AgentsModule, ModelProviderModule],
  providers: [AgentOrchestratorService],
  exports: [AgentOrchestratorService],
})
export class OrchestrationModule {}
