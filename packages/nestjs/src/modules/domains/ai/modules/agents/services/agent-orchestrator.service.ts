import {
  HumanMessage,
  MessageContentText,
  SystemMessage,
} from "@langchain/core/messages";
import { Injectable, Logger } from "@nestjs/common";

import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers/ports/primary-model.port";
import { normalizeMessage } from "../agent.utils";
import {
  AgentHealthResult,
  AgentInvocationInput,
  AgentInvocationResult,
} from "../ports/agent.port";
import { AgentRegistryService } from "./agent-registry.service";

/**
 * Strategy for orchestrating agent selection and invocation
 */
export type OrchestrationStrategy =
  | "primary"
  | "capability-based"
  | "specific"
  | "priority-based";

/**
 * Input for agent orchestration
 */
export type OrchestrationInput = AgentInvocationInput & {
  /**
   * Additional context for LLM-based routing decisions
   */
  routingContext?: {
    /**
     * Preferred agent capabilities or task type
     */
    preferredCapabilities?: string[];

    /**
     * Task description for LLM analysis
     */
    taskDescription?: string;

    /**
     * Any additional routing hints
     */
    hints?: Record<string, any>;
  };
} & (
    | {
        /**
         * Strategy to use for agent selection
         */
        strategy: Exclude<OrchestrationStrategy, "specific">;

        /**
         * Specific agent ID to invoke (required for 'specific' strategy)
         */
        targetAgentId: never;
      }
    | {
        /**
         * Strategy to use for agent selection
         */
        strategy: "specific";

        /**
         * Specific agent ID to invoke (required for 'specific' strategy)
         */
        targetAgentId: string;
      }
  );

/**
 * Result from agent orchestration
 */
export interface OrchestrationResult extends AgentInvocationResult {
  /**
   * ID of the agent that was actually invoked
   */
  invokedAgentId: string;

  /**
   * Strategy that was used for agent selection
   */
  strategyUsed: OrchestrationStrategy;

  /**
   * Reasoning for agent selection (especially for LLM-based routing)
   */
  selectionReasoning?: string;

  /**
   * Alternative agents that were considered
   */
  alternativeAgents?: string[];
}

/**
 * Information about available agents for external use
 */
export interface AvailableAgentInfo {
  agentId: string;
  agentName: string;
  description: string;
  version: string;
  capabilities?: string[];
  priority?: number;
  isPrimary?: boolean;
  isHealthy?: boolean;
}

/**
 * Service responsible for orchestrating agent invocation based on different strategies
 * Provides intelligent routing using LLM-based capability analysis
 */
@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly agentRegistry: AgentRegistryService,
    @InjectPrimaryChatModel()
    private readonly primaryChatModel: PrimaryChatModelPort,
  ) {}

  /**
   * Main orchestration method that routes requests based on strategy
   * @param input - Orchestration input with strategy and agent invocation data
   * @returns Promise resolving to orchestration result
   */
  async orchestrateResponse(
    input: OrchestrationInput,
  ): Promise<OrchestrationResult> {
    this.logger.debug(
      `Orchestrating response with strategy: ${input.strategy}`,
    );

    const startTime = Date.now();

    try {
      let result: AgentInvocationResult;
      let invokedAgentId: string;
      let selectionReasoning: string | undefined;
      let alternativeAgents: string[] | undefined;

      switch (input.strategy) {
        case "specific":
          result = await this.invokeSpecificAgent(input.targetAgentId, input);
          invokedAgentId = input.targetAgentId;
          break;

        case "primary":
          ({ result, agentId: invokedAgentId } =
            await this.invokePrimaryAgent(input));

          break;

        case "capability-based":
          ({
            result,
            agentId: invokedAgentId,
            reasoning: selectionReasoning,
            alternatives: alternativeAgents,
          } = await this.invokeByCapability(input));
          break;

        case "priority-based":
          ({ result, agentId: invokedAgentId } =
            await this.invokeByPriority(input));
          break;

        default:
          throw new Error(
            `Unknown orchestration strategy: ${(input as { strategy: string }).strategy}`,
          );
      }

      const duration = Date.now() - startTime;

      this.logger.debug(
        `Orchestration completed in ${duration}ms using agent: ${invokedAgentId}`,
      );

      return {
        ...result,
        invokedAgentId,
        strategyUsed: input.strategy,
        selectionReasoning,
        alternativeAgents,
        metadata: {
          ...result.metadata,
          orchestrationDuration: duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Orchestration failed after ${duration}ms with strategy: ${input.strategy}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        messages: [],
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        invokedAgentId: "none",
        strategyUsed: input.strategy,
        metadata: {
          orchestrationDuration: duration,
        },
      };
    }
  }

  /**
   * Invoke a specific agent by ID
   * @param agentId - The ID of the agent to invoke
   * @param input - The agent invocation input
   * @returns Promise resolving to agent invocation result
   */
  private async invokeSpecificAgent(
    agentId: string,
    input: AgentInvocationInput,
  ): Promise<AgentInvocationResult> {
    this.logger.debug(`Invoking specific agent: ${agentId}`);

    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return await agent.invoke(input);
  }

  /**
   * Invoke the primary agent
   * @param input - The agent invocation input
   * @returns Promise resolving to result with agent ID and invocation result
   */
  private async invokePrimaryAgent(
    input: AgentInvocationInput,
  ): Promise<{ result: AgentInvocationResult; agentId: string }> {
    this.logger.debug("Invoking primary agent");

    const primaryAgent = this.agentRegistry.getPrimaryAgent();
    if (!primaryAgent) {
      throw new Error("No primary agent found");
    }

    const result = await primaryAgent.invoke(input);
    return { result, agentId: primaryAgent.agentId };
  }

  /**
   * Invoke agent based on LLM-analyzed capability matching
   * @param input - The orchestration input
   * @returns Promise resolving to result with agent ID, invocation result, and reasoning
   */
  private async invokeByCapability(input: OrchestrationInput): Promise<{
    result: AgentInvocationResult;
    agentId: string;
    reasoning: string;
    alternatives: string[];
  }> {
    this.logger.debug("Invoking agent by capability analysis");

    const analysisResult = await this.analyzeRequiredCapabilityWithLLM(input);

    const agent = this.agentRegistry.getAgent(
      analysisResult.recommendedAgentId,
    );
    if (!agent) {
      this.logger.warn(
        `LLM recommended agent ${analysisResult.recommendedAgentId} not found, falling back to primary agent`,
      );
      const fallbackResult = await this.invokePrimaryAgent(input);
      return {
        result: fallbackResult.result,
        agentId: fallbackResult.agentId,
        reasoning: `Fallback to primary agent (${analysisResult.recommendedAgentId} not found)`,
        alternatives: analysisResult.alternatives,
      };
    }

    const result = await agent.invoke(input);
    return {
      result,
      agentId: agent.agentId,
      reasoning: analysisResult.reasoning,
      alternatives: analysisResult.alternatives,
    };
  }

  /**
   * Invoke agent based on priority order
   * @param input - The agent invocation input
   * @returns Promise resolving to result with agent ID and invocation result
   */
  private async invokeByPriority(
    input: AgentInvocationInput,
  ): Promise<{ result: AgentInvocationResult; agentId: string }> {
    this.logger.debug("Invoking agent by priority");

    const agentsByPriority = this.agentRegistry.getSortedAgentsByPriority();
    if (agentsByPriority.length === 0) {
      throw new Error("No agents available");
    }

    const highestPriorityAgent = agentsByPriority[0];
    const result = await highestPriorityAgent.invoke(input);

    return { result, agentId: highestPriorityAgent.agentId };
  }

  /**
   * Analyze required capability using LLM to determine best agent match
   * @param input - The orchestration input
   * @returns Promise resolving to LLM analysis result
   */
  private async analyzeRequiredCapabilityWithLLM(
    input: OrchestrationInput,
  ): Promise<{
    recommendedAgentId: string;
    reasoning: string;
    alternatives: string[];
    confidence: number;
  }> {
    try {
      const availableAgents = await this.getAvailableAgents();

      if (availableAgents.length === 0) {
        throw new Error("No agents available for capability analysis");
      }

      const prompt = this.buildAgentSelectionPrompt(input, availableAgents);

      this.logger.debug("Requesting LLM analysis for agent selection");

      const response = await this.primaryChatModel.model.invoke([
        new SystemMessage(
          "You are an AI agent orchestrator that analyzes user requests and selects the most appropriate agent to handle them. " +
            "You must respond with a valid JSON object containing the recommended agent and reasoning.",
        ),
        new HumanMessage(prompt),
      ]);

      let responseText: string;
      //TODO: the response type might be simple of complex, we are not handling complex return types here becasue we assume they wont happen
      if (typeof response.content !== "string") {
        this.logger.error(
          "Received a complex response from the LLM - we are not properly handling this and instead grabbing the last textual message and giving it to the caller. There is a high chance this is wrong ",
        );
        responseText = response.content
          .filter<MessageContentText>(
            (m): m is MessageContentText => m.type === "text",
          )
          .reverse()[0].text;
      } else {
        responseText = response.content;
      }

      this.logger.debug(`LLM response: ${responseText}`);

      // Parse the LLM response
      const analysis = this.parseLLMAnalysisResponse(
        responseText,
        availableAgents,
      );

      this.logger.debug(
        `LLM recommended agent: ${analysis.recommendedAgentId} (confidence: ${analysis.confidence})`,
      );

      return analysis;
    } catch (error) {
      this.logger.error(
        "Failed to analyze capability with LLM, falling back to primary agent",
        error instanceof Error ? error.stack : undefined,
      );

      // Fallback to primary agent
      const primaryAgent = this.agentRegistry.getPrimaryAgent();
      if (!primaryAgent) {
        throw new Error("LLM analysis failed and no primary agent available");
      }

      return {
        recommendedAgentId: primaryAgent.agentId,
        reasoning: "Fallback to primary agent due to LLM analysis failure",
        alternatives: [],
        confidence: 0.5,
      };
    }
  }

  /**
   * Build prompt for LLM-based agent selection
   * @param input - The orchestration input
   * @param availableAgents - List of available agents
   * @returns Formatted prompt string
   */
  private buildAgentSelectionPrompt(
    input: OrchestrationInput,
    availableAgents: AvailableAgentInfo[],
  ): string {
    const lastMessage = normalizeMessage(
      input.messages[input.messages.length - 1],
    );
    const userRequest =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    const taskDescription =
      input.routingContext?.taskDescription || userRequest;
    const preferredCapabilities =
      input.routingContext?.preferredCapabilities || [];

    //TODO: not sure if the isHealthy filter here is valuable.
    const agentDescriptions = availableAgents
      .filter((agent) => agent.isHealthy)
      .map((agent) => {
        //TODO: im mildly concenred we are getting quite the large collection of random capabilities scattered around all as text strings. Not sure if this is a good or bad thing. I guess it may be ok as we are working with llms
        const capabilities = agent.capabilities?.join(", ") || "general";
        const priority = agent.priority || 0;
        const primaryFlag = agent.isPrimary ? " (PRIMARY)" : "";

        //TODO: if we continue down this path - we should mabey use a prompt template here
        return `- ${agent.agentId}: ${agent.agentName}${primaryFlag}
  Description: ${agent.description}
  Capabilities: ${capabilities}
  Priority: ${priority}
  Version: ${agent.version}`;
      })
      .join("\n\n");

    return `
Analyze the following user request and select the most appropriate agent to handle it.

USER REQUEST:
${taskDescription}

AVAILABLE AGENTS:
${agentDescriptions}

${preferredCapabilities.length > 0 ? `PREFERRED CAPABILITIES: ${preferredCapabilities.join(", ")}` : ""}

Please analyze the request and respond with a JSON object in this exact format:
{
  "recommendedAgentId": "agent_id_here",
  "reasoning": "Detailed explanation of why this agent is the best choice",
  "alternatives": ["alternative_agent_id_1", "alternative_agent_id_2"],
  "confidence": 0.95
}

Consider:
1. Agent capabilities and how well they match the request
2. Agent descriptions and their intended use cases
3. Agent priority levels
4. Whether the agent is marked as primary (Primary agents should be used when there are not good matches of other agents)
5. Any preferred capabilities specified

Choose the agent that best matches the user's needs and provide clear reasoning.
`;
  }

  /**
   * Parse LLM response for agent selection
   * @param responseText - Raw LLM response
   * @param availableAgents - List of available agents for validation
   * @returns Parsed analysis result
   */
  private parseLLMAnalysisResponse(
    responseText: string,
    availableAgents: AvailableAgentInfo[],
  ): {
    recommendedAgentId: string;
    reasoning: string;
    alternatives: string[];
    confidence: number;
  } {
    //TODO: this method should not be nessaasary - We can defined a structured output that the LLM must comply with in langraph/chain
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        recommendedAgentId: string;
        reasoning: string;
        alternatives: string[];
        confidence: number;
      };

      // Validate the response structure
      if (
        !parsed.recommendedAgentId ||
        typeof parsed.recommendedAgentId !== "string"
      ) {
        throw new Error(
          "Missing or invalid recommendedAgentId in LLM response",
        );
      }

      // Validate that the recommended agent exists
      const agentExists = availableAgents.some(
        (agent) => agent.agentId === parsed.recommendedAgentId,
      );

      if (!agentExists) {
        throw new Error(
          `Recommended agent ${parsed.recommendedAgentId} not found in available agents`,
        );
      }

      // Filter alternatives to only include existing agents
      const validAlternatives = (parsed.alternatives || []).filter(
        (agentId: string) =>
          availableAgents.some((agent) => agent.agentId === agentId) &&
          agentId !== parsed.recommendedAgentId,
      );

      return {
        recommendedAgentId: parsed.recommendedAgentId,
        reasoning: parsed.reasoning || "No reasoning provided",
        alternatives: validAlternatives,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to parse LLM response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      // Fallback to first available healthy agent
      const fallbackAgent = availableAgents.find((agent) => agent.isHealthy);
      if (!fallbackAgent) {
        throw new Error(
          "No healthy agents available and LLM response parsing failed",
        );
      }

      return {
        recommendedAgentId: fallbackAgent.agentId,
        reasoning:
          "Fallback agent selected due to LLM response parsing failure",
        alternatives: [],
        confidence: 0.3,
      };
    }
  }

  /**
   * Get information about all available agents
   * @returns Promise resolving to array of agent information
   */
  async getAvailableAgents(): Promise<AvailableAgentInfo[]> {
    const agentInfo = this.agentRegistry.getAllAgentInfo();
    const availableAgents: AvailableAgentInfo[] = [];

    for (const { agent, metadata } of agentInfo) {
      try {
        //TODO: still not convinced about this healthcheck - feels overkill
        // Check agent health
        const healthResult = await agent.healthCheck();

        // Get capabilities if available
        let capabilities: string[] | undefined;
        if (agent.getCapabilities) {
          try {
            const capabilityInfo = await agent.getCapabilities();
            capabilities = capabilityInfo.supportedTaskTypes;
          } catch (error) {
            this.logger.debug(
              `Failed to get capabilities for agent ${agent.agentId}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        //TODO: I would think this is the best place to retreive capabilities from - not a fallback
        // Use metadata capabilities as fallback
        if (!capabilities && metadata.capabilities) {
          capabilities = metadata.capabilities;
        }

        availableAgents.push({
          agentId: agent.agentId,
          agentName: agent.agentName,
          description: agent.description,
          version: agent.version,
          capabilities,
          priority: metadata.priority,
          isPrimary: metadata.isPrimary,
          isHealthy: healthResult.healthy,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to get info for agent ${agent.agentId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );

        // Include agent with minimal info and mark as unhealthy
        availableAgents.push({
          agentId: agent.agentId,
          agentName: agent.agentName,
          description: agent.description,
          version: agent.version,
          capabilities: metadata.capabilities,
          priority: metadata.priority,
          isPrimary: metadata.isPrimary,
          isHealthy: false,
        });
      }
    }

    return availableAgents;
  }

  /**
   * Perform health check on all registered agents
   * @returns Promise resolving to map of agent health results
   */
  async healthCheckAllAgents(): Promise<Map<string, AgentHealthResult>> {
    this.logger.debug("Performing health check on all agents");

    const allAgents = this.agentRegistry.getAllAgents();
    const healthResults = new Map<string, AgentHealthResult>();

    const healthCheckPromises = Array.from(allAgents.entries()).map(
      async ([agentId, agent]) => {
        try {
          const healthResult = await agent.healthCheck();
          healthResults.set(agentId, healthResult);

          this.logger.debug(
            `Agent ${agentId} health check: ${healthResult.healthy ? "HEALTHY" : "UNHEALTHY"}`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          this.logger.warn(
            `Health check failed for agent ${agentId}: ${errorMessage}`,
          );

          healthResults.set(agentId, {
            healthy: false,
            status: `Health check failed: ${errorMessage}`,
            metrics: {
              lastSuccess: undefined,
              successCount: 0,
              errorCount: 1,
            },
          });
        }
      },
    );

    await Promise.all(healthCheckPromises);

    const healthyCount = Array.from(healthResults.values()).filter(
      (result) => result.healthy,
    ).length;

    this.logger.log(
      `Health check completed: ${healthyCount}/${allAgents.size} agents healthy`,
    );

    return healthResults;
  }
}
