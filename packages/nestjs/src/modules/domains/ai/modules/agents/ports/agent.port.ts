import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
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
   * Additional context that might be needed by the agent
   */
  context?: Record<string, any>;

  /**
   * Custom system prompt or instructions for this invocation
   */
  systemPrompt?: string;

  /**
   * Metadata specific to this invocation
   */
  metadata?: Record<string, any>;
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
 * Health check result for agent status
 */
export interface AgentHealthResult {
  /**
   * Whether the agent is healthy and ready to process requests
   */
  healthy: boolean;

  /**
   * Status message or description
   */
  status: string;

  /**
   * Additional health metrics
   */
  metrics?: {
    /**
     * Last successful invocation timestamp
     */
    lastSuccess?: Date;

    /**
     * Number of successful invocations
     */
    successCount?: number;

    /**
     * Number of failed invocations
     */
    errorCount?: number;

    /**
     * Average response time in milliseconds
     */
    averageResponseTime?: number;

    /**
     * Any additional metrics
     */
    [key: string]: any;
  };
}

/**
 * Port interface defining the contract for all agents
 */
export interface AgentPort {
  /**
   * Unique identifier for the agent
   */
  readonly agentId: string;

  /**
   * Human-readable name of the agent
   */
  readonly agentName: string;

  /**
   * Description of the agent's capabilities
   */
  readonly description: string;

  /**
   * Version of the agent implementation
   */
  readonly version: string;

  /**
   * Invoke the agent with the provided input
   * @param input - The input parameters for the agent
   * @returns Promise resolving to the agent's response
   */
  invoke(input: AgentInvocationInput): Promise<AgentInvocationResult>;

  /**
   * Check the health and readiness of the agent
   * @returns Promise resolving to the health status
   */
  healthCheck(): Promise<AgentHealthResult>;

  /**
   * Optional: Get agent-specific configuration or capabilities
   * @returns Configuration object describing the agent's capabilities
   */
  getCapabilities?(): Promise<{
    /**
     * Types of tasks this agent can handle
     */
    supportedTaskTypes?: string[];

    /**
     * Required input parameters
     */
    requiredInputs?: string[];

    /**
     * Optional input parameters
     */
    optionalInputs?: string[];

    /**
     * Maximum number of messages the agent can process
     */
    maxMessages?: number;

    /**
     * Estimated response time range in milliseconds
     */
    responseTimeRange?: {
      min: number;
      max: number;
    };

    /**
     * Any additional capability information
     */
    [key: string]: any;
  }>;

  /**
   * Optional: Validate input before processing
   * @param input - The input to validate
   * @returns Promise resolving to validation result
   */
  validateInput?(input: AgentInvocationInput): Promise<{
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  }>;
}
