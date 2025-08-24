import {
  HumanMessage,
  MessageContentText,
  SystemMessage,
} from "@langchain/core/messages";
import {
  Annotation,
  CompiledStateGraph,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { ConversationSession } from "src/common/types/conversation-session.type";
import { normalizeMessage } from "src/common/utils/message.utils";

import {
  AgentInvocationInput,
  AgentInvocationResult,
  AgentRegistryService,
} from "../../agents";
import {
  type CheckpointerPort,
  InjectCheckpointer,
} from "../../llm-storage/ports/checkpointer.port";
import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers";

type RoutingContext = {
  preferredCapabilities?: string[];
  taskDescription?: string;
  hints?: Record<string, any>;
};
/**
 * Input for graph orchestration
 */
export type GraphOrchestrationInput = AgentInvocationInput & {
  // /**
  //  * Array of messages in the conversation
  //  */
  // messages: BaseMessageLike[];
  // /**
  //  * Session context for maintaining conversation state
  //  */
  // session: ConversationSession;
  /**
   * Additional context for routing decisions
   */
  routingContext?: RoutingContext;
  // /**
  //  * Custom system prompt for this invocation
  //  */
  // systemPrompt?: string;
  // /**
  //  * Additional metadata
  //  */
  // metadata?: Record<string, any>;
};

/**
 * Result from graph orchestration
 */
export interface GraphOrchestrationResult extends AgentInvocationResult {
  /**
   * ID of the agent that was actually invoked
   */
  invokedAgentId: string;

  /**
   * Reasoning for agent selection
   */
  selectionReasoning?: string;

  /**
   * Alternative agents that were considered
   */
  alternativeAgents?: string[];
}

/**
 * Available agent information for routing decisions
 */
interface AvailableAgentInfo {
  agentId: string;
  agentName: string;
  description: string;
  capabilities?: string[];
  priority?: number;
  isPrimary?: boolean;
}

/**
 * Service responsible for building and managing the main orchestration graph
 * Uses LangGraph to coordinate calls to agent sub-graphs
 */
@Injectable()
export class GraphOrchestratorService {
  private readonly logger = new Logger(GraphOrchestratorService.name);
  private orchestrationGraph?: CompiledStateGraph<
    typeof this.stateDefinition.State,
    typeof this.stateDefinition.Update,
    string
  >;
  private stateDefinition = Annotation.Root({
    // Use MessagesAnnotation for the messages field
    ...MessagesAnnotation.spec,
    session: Annotation<ConversationSession>(),
    selectedAgentId: Annotation<string | undefined>(),
    routingReasoning: Annotation<string | undefined>(),
    alternativeAgents: Annotation<string[] | undefined>(),

    routingContext: Annotation<RoutingContext | undefined>(),
    systemPrompt: Annotation<string | undefined>(),

    metadata: Annotation<Record<string, any>>({
      reducer: (exitingMetadata, newMetadata) => {
        return {
          ...exitingMetadata,
          ...newMetadata,
        };
      },
      default: undefined,
    }),

    /**
     * Contextual data specifically for the agent that is being invoked
     */
    context: Annotation<Record<string, any> | undefined>(),
    invoker: Annotation<
      | {
          name: string;
          currentDateIso: string;
          timezone: string;
        }
      | undefined
    >(),
  });

  constructor(
    private readonly agentRegistry: AgentRegistryService,
    @InjectPrimaryChatModel()
    private readonly primaryChatModel: PrimaryChatModelPort,
    @InjectCheckpointer()
    private readonly checkpointer: CheckpointerPort,
  ) {}

  /**
   * Get or build the orchestration graph
   */
  private getOrchestrationGraph(): typeof this.orchestrationGraph {
    if (!this.orchestrationGraph) {
      this.orchestrationGraph = this.buildOrchestrationGraph();
    }
    return this.orchestrationGraph;
  }

  /**
   * Build the main orchestration graph
   */
  private buildOrchestrationGraph(): typeof this.orchestrationGraph {
    this.logger.debug("Building orchestration graph");

    const workflow = new StateGraph(this.stateDefinition)

      // Add nodes
      .addNode("router", this.routerNode.bind(this))

      // Add edges
      .addConditionalEdges(
        START,
        this.checkForExistingConversationEdge.bind(this),
      )
      .addConditionalEdges("router", this.routingDecision.bind(this));

    // Establish each agent as a node, and add a edge to route to END
    this.agentRegistry.getAllAgents().forEach((agent, agentId) => {
      workflow.addNode(agentId, agent.getGraph());
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      workflow.addEdge(agentId as any, END);
    });

    return workflow.compile({ checkpointer: this.checkpointer.instance });
  }

  /**
   * Returns node names - 'router' is the default, but if a specific agentId has previously been set (i.e. a past turn) then return that to short circuit and jump straight to the node
   * @param state
   * @returns {string}
   */
  private checkForExistingConversationEdge(
    state: typeof this.stateDefinition.State,
  ) {
    this.logger.debug(state);
    this.logger.debug("checkForExistingConversationEdge state above");
    if (state.selectedAgentId) {
      return state.selectedAgentId;
    }
    return "router";
  }

  /**
   * Router node that analyzes input and selects appropriate agent
   */
  private async routerNode(
    state: typeof this.stateDefinition.State,
  ): Promise<typeof this.stateDefinition.Update> {
    this.logger.debug("Executing router node");

    try {
      const availableAgents = this.getAvailableAgents();

      if (availableAgents.length === 0) {
        throw new Error("No agents available for routing");
      }

      // If only one agent is available, route to it
      if (availableAgents.length === 1) {
        const agent = availableAgents[0];
        return {
          selectedAgentId: agent.agentId,
          routingReasoning: "Only one agent available",
          alternativeAgents: [],
        };
      }

      // Analyze with LLM to determine best agent
      const analysisResult = await this.analyzeRequiredCapabilityWithLLM(state);

      return {
        selectedAgentId: analysisResult.recommendedAgentId,
        routingReasoning: analysisResult.reasoning,
        alternativeAgents: analysisResult.alternatives,
      };
    } catch (error) {
      this.logger.error("Router node failed", error);

      throw error;

      // return {
      //   selectedAgentId: primaryAgent.agentId,
      //   routingReasoning: `Fallback to primary agent due to routing error: ${
      //     error instanceof Error ? error.message : "Unknown error"
      //   }`,
      //   alternativeAgents: [],
      // };
    }
  }

  // /**
  //  * Primary agent node that invokes the primary agent's graph
  //  */
  // private async primaryAgentNode(
  //   state: typeof this.stateDefinition.State,
  // ): Promise<typeof this.stateDefinition.Update> {
  //   this.logger.debug("Executing primary agent node");

  //   const primaryAgent = this.agentRegistry.getPrimaryAgent();
  //   if (!primaryAgent) {
  //     throw new Error("No primary agent found");
  //   }

  //   const result = await this.invokeAgentGraph(primaryAgent.agentId, state);

  //   return {
  //     result,
  //   };
  // }

  /**
   * Specific agent node that invokes a selected agent's graph
   */
  // private async specificAgentNode(
  //   state: typeof this.stateDefinition.State,
  // ): Promise<typeof this.stateDefinition.Update> {
  //   this.logger.debug(
  //     `Executing specific agent node for: ${state.selectedAgentId}`,
  //   );

  //   if (!state.selectedAgentId) {
  //     throw new Error("No agent selected for specific agent node");
  //   }

  //   const result = await this.invokeAgentGraph(state.selectedAgentId, state);

  //   return {
  //     result,
  //   };
  // }

  // /**
  //  * Routing decision function that determines which path to take
  //  */
  // private routingDecision(
  //   state: typeof this.stateDefinition.State,
  // ): "primary_agent" | "specific_agent" {
  //   if (!state.selectedAgentId) {
  //     throw new Error("No agent selected in routing decision");
  //   }

  //   const primaryAgent = this.agentRegistry.getPrimaryAgent();
  //   const isPrimaryAgent = primaryAgent?.agentId === state.selectedAgentId;

  //   this.logger.debug(
  //     `Routing to: ${isPrimaryAgent ? "primary_agent" : "specific_agent"} (${state.selectedAgentId})`,
  //   );

  //   return isPrimaryAgent ? "primary_agent" : "specific_agent";
  // }
  /**
   * Routing decision function that determines which path to take
   */
  private routingDecision(state: typeof this.stateDefinition.State): string {
    if (!state.selectedAgentId) {
      throw new Error("No agent selected in routing decision");
    }
    return state.selectedAgentId;
  }

  // /**
  //  * Invoke an agent's graph and collect the result
  //  */
  // private async invokeAgentGraph(
  //   agentId: string,
  //   state: typeof this.stateDefinition.State,
  // ): Promise<AgentInvocationResult> {
  //   this.logger.debug(`Invoking agent graph: ${agentId}`);

  //   const agent = this.agentRegistry.getAgent(agentId);
  //   if (!agent) {
  //     throw new Error(`Agent not found: ${agentId}`);
  //   }

  //   try {
  //     const startTime = Date.now();

  //     // Prepare input for the agent graph
  //     const agentInput: Record<string, any> = {
  //       messages: state.messages,
  //       session: state.session,
  //       metadata: state.metadata,
  //       context: state.context,

  //       // The following properties are context that are expected by the prompt that is built in the primary agent
  //       // TODO: feels like a code smell having to set these variables here
  //       // humanName: state.invoker?.name,
  //       // currentDateIso: state.invoker?.currentDateIso,
  //       // currentTimezone: state.invoker?.timezone,
  //       // systemPrompt: state.systemPrompt,
  //     } satisfies AgentInvocationInput & Record<string, any>;

  //     // Invoke the agent's graph
  //     const graphResult = await agent.getGraph().invoke(agentInput, {
  //       configurable: {
  //         thread_id: state.session.threadId,
  //       },
  //     });

  //     const duration = Date.now() - startTime;

  //     this.logger.debug(`Agent ${agentId} completed in ${duration}ms`);

  //     // Extract the result from the graph state
  //     // The exact structure depends on how the agent graphs are implemented
  //     // For now, we'll assume the graph returns the result in a standard format
  //     const result: AgentInvocationResult = {
  //       messages:
  //         "messages" in graphResult &&
  //         Array.isArray(graphResult.messages) &&
  //         graphResult.messages.every(isBaseMessage)
  //           ? graphResult.messages
  //           : [],
  //       success: true,
  //       metadata: {
  //         ...("metadata" in graphResult &&
  //         typeof graphResult.metadata === "object"
  //           ? graphResult.metadata
  //           : {}),
  //         duration,
  //         agentId,
  //       },
  //     };

  //     return result;
  //   } catch (error) {
  //     this.logger.error(`Agent ${agentId} invocation failed`, error);

  //     return {
  //       messages: [],
  //       success: false,
  //       error: error instanceof Error ? error.message : "Unknown error",
  //       metadata: {
  //         agentId,
  //         error: true,
  //       },
  //     };
  //   }
  // }

  /**
   * Analyze required capability using LLM to determine best agent match
   */
  private async analyzeRequiredCapabilityWithLLM(
    state: typeof this.stateDefinition.State,
  ): Promise<{
    recommendedAgentId: string;
    reasoning: string;
    alternatives: string[];
    confidence: number;
  }> {
    try {
      const availableAgents = this.getAvailableAgents();

      if (availableAgents.length === 0) {
        throw new Error("No agents available for capability analysis");
      }

      const prompt = this.buildAgentSelectionPrompt(state, availableAgents);

      this.logger.debug("Requesting LLM analysis for agent selection");

      const response = await this.primaryChatModel.model.invoke([
        new SystemMessage(
          "You are an AI agent orchestrator that analyzes user requests and selects the most appropriate agent to handle them. " +
            "You must respond with a valid JSON object containing the recommended agent and reasoning.",
        ),
        new HumanMessage(prompt),
      ]);

      let responseText: string;
      if (typeof response.content !== "string") {
        this.logger.error(
          "Received a complex response from the LLM - extracting text content",
        );
        responseText = response.content
          .filter<MessageContentText>(
            (m): m is MessageContentText => m.type === "text",
          )
          .reverse()[0].text;
      } else {
        responseText = response.content;
      }

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
      throw error;

      // return {
      //   recommendedAgentId: primaryAgent.agentId,
      //   reasoning: "Fallback to primary agent due to LLM analysis failure",
      //   alternatives: [],
      //   confidence: 0.5,
      // };
    }
  }

  /**
   * Build prompt for LLM-based agent selection
   */
  private buildAgentSelectionPrompt(
    state: typeof this.stateDefinition.State,
    availableAgents: AvailableAgentInfo[],
  ): string {
    const lastMessage = normalizeMessage(
      state.messages[state.messages.length - 1],
    );
    const userRequest =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    const taskDescription =
      state.routingContext?.taskDescription || userRequest;
    const preferredCapabilities =
      state.routingContext?.preferredCapabilities || [];

    const agentDescriptions = availableAgents
      .map((agent) => {
        const capabilities = agent.capabilities?.join(", ") || "general";
        const priority = agent.priority || 0;
        const primaryFlag = agent.isPrimary ? " (PRIMARY)" : "";

        return `- ${agent.agentId}: ${agent.agentName}${primaryFlag}
  Description: ${agent.description}
  Capabilities: ${capabilities}
  Priority: ${priority}`;
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
4. Whether the agent is marked as primary (Primary agents should be used when there are no good matches of other agents)
5. Any preferred capabilities specified

Choose the agent that best matches the user's needs and provide clear reasoning.
`;
  }

  /**
   * Parse LLM response for agent selection
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

      // Fallback to first available agent
      const fallbackAgent = availableAgents[0];
      if (!fallbackAgent) {
        throw new Error("No agents available and LLM response parsing failed");
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
   */
  private getAvailableAgents(): AvailableAgentInfo[] {
    const agentInfo = this.agentRegistry.getAllAgentInfo();
    const availableAgents: AvailableAgentInfo[] = [];

    for (const { agent, metadata } of agentInfo) {
      try {
        availableAgents.push({
          agentId: agent.agentId,
          agentName: metadata.agentId,
          description: metadata.description || "",
          capabilities: metadata.capabilities,
          priority: metadata.priority,
          isPrimary: metadata.isPrimary,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to get info for agent ${agent.agentId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return availableAgents;
  }

  /**
   * Main orchestration method that processes requests using the LangGraph
   *
   * This method orchestrates all the agents together into a super agent :-D
   */
  async orchestrateResponse(
    input: GraphOrchestrationInput,
  ): Promise<GraphOrchestrationResult> {
    this.logger.debug("Starting graph orchestration");

    const startTime = Date.now();

    try {
      const graph = this.getOrchestrationGraph();

      // Build initial state
      const initialState: typeof this.stateDefinition.State = {
        messages: input.messages.map((msg) => normalizeMessage(msg)),
        session: input.session,
        routingContext: input.routingContext ?? undefined,
        systemPrompt: input.systemPrompt ?? undefined,
        metadata: input.metadata || {},
        selectedAgentId: undefined,
        alternativeAgents: undefined,
        routingReasoning: undefined,
        context: undefined,
        invoker: input.invoker,
      };

      // Invoke the orchestration graph
      const finalState = (await graph!.invoke(initialState, {
        subgraphs: false,
        configurable: { thread_id: input.session.threadId },
      })) as typeof this.stateDefinition.State;

      const duration = Date.now() - startTime;

      this.logger.debug(
        `Graph orchestration completed in ${duration}ms using agent: ${finalState.selectedAgentId}`,
      );

      return {
        messages: finalState.messages,
        success: true,
        invokedAgentId: finalState.selectedAgentId || "unknown",
        selectionReasoning: finalState.routingReasoning,
        alternativeAgents: finalState.alternativeAgents,
        metadata: {
          // ...finalState.result.metadata,
          orchestrationDuration: duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Graph orchestration failed after ${duration}ms`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        messages: [],
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        invokedAgentId: "none",
        metadata: {
          orchestrationDuration: duration,
        },
      };
    }
  }
}
