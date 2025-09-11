import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { AgentServicesModule } from "../domains/ai/modules/agent-services";
import { AgentsIndicator } from "./agents.health";
import { HealthController } from "./health.controller";

@Module({
  imports: [TerminusModule, AgentServicesModule],
  controllers: [HealthController],
  providers: [AgentsIndicator],
})
export class HealthModule {}
