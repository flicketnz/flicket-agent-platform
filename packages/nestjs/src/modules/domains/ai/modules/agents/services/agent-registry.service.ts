import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";

import { Agent, AgentMetadata, isAgent } from "../decorators/agent.decorator";
import { GraphAgentPort } from "../ports/graph-agent.port";

/**
 * Service responsible for discovering and registering agents using the @Agent decorator
 * Provides module-scoped agent discovery and retrieval capabilities for graph-based orchestration
 */
@Injectable()
export class AgentRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AgentRegistryService.name);

  /**
   * Map of agents indexed by agentId
   */
  private readonly agents = new Map<string, GraphAgentPort>();

  /**
   * Map of agent metadata indexed by agentId
   */
  private readonly agentMetadata = new Map<string, AgentMetadata>();

  constructor(private readonly discoveryService: DiscoveryService) {}

  /**
   * Initialize the service by discovering and registering all agents
   */
  onModuleInit(): void {
    this.logger.log("Starting agent discovery...");

    // Get all providers from the current module scope
    const agentProviders = this.discoveryService
      .getProviders()
      .filter(
        (provider) =>
          provider.instance &&
          isAgent((provider.instance as object).constructor),
      );

    this.logger.debug(`Found ${agentProviders.length} agent providers`);

    // Register each discovered agent
    for (const wrapper of agentProviders) {
      this.registerAgent(wrapper);
    }

    // Note: Primary agent validation removed as isPrimary is no longer supported
    // this.validatePrimaryAgentConfiguration();

    // Log summary
    this.logger.log(
      `Agent discovery completed. Registered ${this.agents.size} agents.`,
    );
  }

  /**
   * Validate primary agent configuration and log warnings if issues are found
   * @deprecated isPrimary is no longer supported in the new graph-based architecture
   */
  private validatePrimaryAgentConfiguration(): void {
    // This method is deprecated and no longer used
    // Primary agent concept has been removed from the new architecture
    /*
    const primaryAgents = this.getAllAgentInfo().filter(
      (info) => info.metadata.isPrimary,
    );

    if (primaryAgents.length === 0) {
      this.logger.warn(
        "No primary agent found. Consider marking one agent with isPrimary: true for default operations.",
      );
    } else if (primaryAgents.length > 1) {
      const primaryAgentIds = primaryAgents
        .map((info) => info.metadata.agentId)
        .join(", ");
      this.logger.warn(
        `Multiple primary agents detected: [${primaryAgentIds}]. ` +
          "Only one agent should be marked with isPrimary: true. " +
          "The first one found will be used as the primary agent.",
      );
    }
    */
  }

  /**
   * Register a single agent from a provider wrapper
   */
  private registerAgent(agentProvider: InstanceWrapper): void {
    this.logger.debug(`Starting registration of ${agentProvider.name}`);

    try {
      const agentInstance = agentProvider.instance as GraphAgentPort;

      const metadata = this.discoveryService.getMetadataByDecorator(
        Agent,
        agentProvider,
      );

      if (!metadata) {
        this.logger.warn(
          `Agent ${agentProvider.name} has @Agent decorator but no metadata found`,
        );
        return;
      }

      // Validate that the agent implements the required interface
      if (!agentInstance.agentId) {
        this.logger.error(
          `Agent ${agentInstance.constructor.name} does not properly implement GraphAgentPort interface`,
        );
        return;
      }

      // Check for duplicate agent IDs
      if (this.agents.has(agentInstance.agentId)) {
        this.logger.error(
          `Duplicate agent ID detected: ${metadata.agentId}. Skipping registration.`,
        );
        return;
      }

      // Register the agent and its metadata
      this.agents.set(agentInstance.agentId, agentInstance);
      this.agentMetadata.set(agentInstance.agentId, metadata);

      this.logger.debug(
        `Registered agent: ${metadata.agentId} (${agentInstance.constructor.name})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register agent from ${agentProvider.name || "unknown"}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Get an agent by its unique identifier
   * @param agentId - The unique identifier of the agent
   * @returns The agent instance or undefined if not found
   */
  getAgent(agentId: string): GraphAgentPort | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all registered agents
   * @returns Map of all agents indexed by agentId
   */
  getAllAgents(): Map<string, GraphAgentPort> {
    return new Map(this.agents);
  }

  /**
   * Get agents that have a specific capability
   * @param capability - The capability to filter by
   * @returns Array of agents that have the specified capability
   */
  getAgentsByCapability(capability: string): GraphAgentPort[] {
    const agentsWithCapability: GraphAgentPort[] = [];

    for (const [agentId, agent] of this.agents) {
      const metadata = this.agentMetadata.get(agentId);
      if (metadata?.capabilities.includes(capability)) {
        agentsWithCapability.push(agent);
      }
    }

    return agentsWithCapability;
  }

  /**
   * Get the primary agent (agent marked with isPrimary: true)
   * @deprecated Primary agent concept has been removed in the new graph-based architecture
   * @returns undefined as primary agents are no longer supported
   */
  getPrimaryAgent(): GraphAgentPort | undefined {
    // Primary agent concept has been removed in the new graph-based architecture
    return undefined;
    /*
    for (const [agentId, agent] of this.agents) {
      const metadata = this.agentMetadata.get(agentId);
      if (metadata?.isPrimary) {
        return agent;
      }
    }
    return undefined;
    */
  }

  /**
   * Get metadata for a specific agent
   * @param agentId - The unique identifier of the agent
   * @returns The agent metadata or undefined if not found
   */
  getAgentMetadata(agentId: string): AgentMetadata | undefined {
    return this.agentMetadata.get(agentId);
  }

  /**
   * Get all agents with their metadata
   * @returns Array of objects containing agent instance and metadata pairs
   */
  getAllAgentInfo(): Array<{ agent: GraphAgentPort; metadata: AgentMetadata }> {
    const agentInfo: Array<{ agent: GraphAgentPort; metadata: AgentMetadata }> =
      [];

    for (const [agentId, agent] of this.agents) {
      const metadata = this.agentMetadata.get(agentId);
      if (metadata) {
        agentInfo.push({ agent, metadata });
      }
    }

    return agentInfo;
  }

  /**
   * Get all agents sorted by priority (highest priority first)
   * @returns Array of agents sorted by priority
   */
  getSortedAgentsByPriority(): GraphAgentPort[] {
    const agentInfo = this.getAllAgentInfo();

    // Sort by priority (higher priority first), then by agentId for consistency
    agentInfo.sort((a, b) => {
      const priorityA = a.metadata.priority ?? 0;
      const priorityB = b.metadata.priority ?? 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // If priorities are equal, sort by agentId for consistency
      return a.metadata.agentId.localeCompare(b.metadata.agentId);
    });

    return agentInfo.map((info) => info.agent);
  }

  /**
   * Check if any agents are registered
   * @returns True if at least one agent is registered
   */
  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  /**
   * Get the count of registered agents
   * @returns Number of registered agents
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Get a list of all agent IDs
   * @returns Array of agent IDs
   */
  getAllAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Check if a specific agent is registered
   * @param agentId - The agent ID to check
   * @returns True if the agent is registered
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }
}
