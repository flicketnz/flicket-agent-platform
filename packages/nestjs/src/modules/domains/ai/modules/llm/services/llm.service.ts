import { HumanMessage } from "@langchain/core/messages";
import { Injectable, Logger } from "@nestjs/common";
import { ConversationSession } from "src/common/types/conversation-session.type";

import { AgentInvocationInput } from "../../agents/ports";
import { GraphOrchestratorService } from "../../orchestration";

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly graphOrchestrator: GraphOrchestratorService) {}

  async generateResponse(
    question: string,
    options: {
      session: ConversationSession;
      additionalSystemPrompt?: string;
      progressCallback?: (message: string) => void | Promise<void>;
      preferredAgent?: string;
    },
  ) {
    this.logger.debug("sessionId", options.session.sessionId);

    // Create AgentInvocationInput from the parameters
    const agentInput: AgentInvocationInput = {
      messages: [new HumanMessage(question)],
      session: options.session,
      systemPrompt: options.additionalSystemPrompt,
      invoker: {
        name: `<@${options.session.userId}> (using exactly this syntax will translate to the humans name as a mention in slack)`,
        currentDateIso: options.session.lastActivity.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, //TODO get timezone from invoker not server
      },
    };

    // Use orchestrator to handle the request
    const orchestrationResult =
      await this.graphOrchestrator.orchestrateResponse(agentInput);

    // Convert the result to maintain backward compatibility
    // The existing interface expects the agent result format, so we return the messages
    return {
      messages: orchestrationResult.messages,
      invokedAgentId: orchestrationResult.invokedAgentId,
      // strategyUsed: orchestrationResult.strategyUsed,
      selectionReasoning: orchestrationResult.selectionReasoning,
      metadata: orchestrationResult.metadata,
    };
  }

  /**
   * Gets available agents (replacing getAvailableTools)
   * @deprecated Use getAvailableAgents() instead
   */
  getAvailableTools(): any[] {
    this.logger.warn(
      "getAvailableTools() is deprecated. Use getAvailableAgents() instead.",
    );
    // Return empty array for backward compatibility
    return [];
  }
}
