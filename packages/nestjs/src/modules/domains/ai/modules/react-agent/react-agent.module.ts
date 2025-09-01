import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { TerminusModule } from "@nestjs/terminus";

import { ModelProviderModule } from "../model-providers";
import { ReactAgentAdapter } from "./adapters";

@Module({
  imports: [TerminusModule, ModelProviderModule, DiscoveryModule],
  providers: [ReactAgentAdapter],
})
export class ReactAgentModule {}
