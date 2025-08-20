import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import { LangGraphReactAgentAdapter } from "./adapters";
import { AgentRegistryService } from "./services";

@Module({
  imports: [HttpModule, DiscoveryModule, LlmStorageModule],

  providers: [LangGraphReactAgentAdapter, AgentRegistryService],
  exports: [AgentRegistryService, LangGraphReactAgentAdapter],
})
export class AgentsModule {}
