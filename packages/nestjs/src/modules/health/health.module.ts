import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { AgentsModule } from "../domains/ai/modules/agent-services";
import { AgentsIndicator } from "./agents.health";
import { HealthController } from "./health.controller";

@Module({
  imports: [TerminusModule, AgentsModule],
  controllers: [HealthController],
  providers: [AgentsIndicator],
})
export class HealthModule {}
