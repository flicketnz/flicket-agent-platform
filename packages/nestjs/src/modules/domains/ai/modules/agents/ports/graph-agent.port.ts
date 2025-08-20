import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { ConversationSession } from "src/common/types/conversation-session.type";

/**
 * Input parameters for agent invocation
 */
export interface AgentInvocationInput {
  /**
   * Array of messages in the conversation
   */
  messages: BaseMessageLike[];

  /**
   * Session context for maintaining conversation state
   */
  session: ConversationSession;

  /**
   * Custom system prompt or instructions for this invocation
   */
  systemPrompt?: string;

  /**
   * Metadata specific to this invocation
   */
  metadata?: Record<string, any>;

  /**
   * Contextual data specifically for the agent that is being invoked
   */
  context?: Record<string, any>;

  /**
   * Details about the invoker
   */
  invoker?: {
    /**
     * name of the invoker - may be used in conversational replies
     */
    name: string;
    /**
     * Timezone of the invoker
     */
    timezone: string;
    /**
     * current date in ISO format of the invoker
     */
    currentDateIso: string;
  };
}

/**
 * Result returned from agent invocation
 */
export interface AgentInvocationResult {
  /**
   * Generated messages from the agent
   */
  messages: BaseMessage[];

  /**
   * Metadata about the invocation result
   */
  metadata?: {
    /**
     * Time taken for the invocation in milliseconds
     */
    duration?: number;

    /**
     * Confidence score of the response (0-1)
     */
    confidence?: number;

    /**
     * Any additional metadata from the agent
     */
    [key: string]: any;
  };

  /**
   * Suggested next agent to invoke based on the result
   */
  nextSuggestedAgent?: string;

  /**
   * Whether the agent completed successfully
   */
  success: boolean;

  /**
   * Error message if the invocation failed
   */
  error?: string;
}

/**
 * Port interface defining the contract for all agents
 */
export abstract class GraphAgentPort {
  /**
   * Unique identifier for the agent
   */
  abstract readonly agentId: string;

  /**
   * The langgraph instance for the agent
   */
  protected abstract readonly graph:
    | CompiledStateGraph<any, any, string>
    | undefined;

  // TODO: we could define some of our state here (in the CompiledStateGraph type) that we expect to be common
  public abstract getGraph(): Exclude<typeof this.graph, undefined>;
}
