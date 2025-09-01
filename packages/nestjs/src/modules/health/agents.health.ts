import { Injectable, Logger } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";

import { AgentRegistryService } from "../domains/ai/modules/agents";

@Injectable()
export class AgentsIndicator {
  private readonly logger = new Logger(AgentsIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    const agentResponses = await Promise.all(
      this.agentRegistry.getAllAgentInfo().map(async (agentInfo) => {
        const agentHealthcheck = await agentInfo.agent.healthcheck();

        return {
          ...agentInfo.metadata,
          ...agentHealthcheck,
        };
      }),
    );

    if (agentResponses.some((d) => d.status === "down")) {
      return indicator.down({ agents: agentResponses });
    }

    return indicator.up({ agents: agentResponses });
  }
}
