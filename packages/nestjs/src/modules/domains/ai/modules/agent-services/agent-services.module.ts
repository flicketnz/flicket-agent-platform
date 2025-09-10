import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { AgentRegistryService } from "./services";

@Module({
  imports: [DiscoveryModule],

  providers: [AgentRegistryService],
  exports: [AgentRegistryService],
})
export class AgentServicesModule {}
