import { BaseMessage } from "@langchain/core/messages";
import { Query } from "@nestjs/cqrs";

import { ConversationSession } from "../types/conversation-session.type";

/**
 * Progress callback for real-time response streaming
 */
export type ProgressCallback = (
  message: string,
  stage?: string,
) => void | Promise<void>;

/**
 * Query for initiating an LLM conversation with agent orchestration support
 */
export class LlmConversationQuery extends Query<BaseMessage> {
  /**
   * The user's message/prompt
   */
  readonly question: string;

  /**
   * Session information for state management
   */
  readonly session: ConversationSession;

  /**
   * Progress callback for real-time updates
   */
  readonly progressCallback?: ProgressCallback;

  /**
   * Custom system prompt extension
   */
  readonly systemPrompt?: string;

  constructor(params: {
    question: string;
    session: ConversationSession;
    progressCallback?: ProgressCallback;
    systemPrompt?: string;
  }) {
    super();

    this.question = params.question;
    this.session = params.session;
    this.progressCallback = params.progressCallback;
    this.systemPrompt = params.systemPrompt;
  }

  /**
   * Creates a new conversation query with minimal required parameters
   */
  static create(question: string, sessionId: string): LlmConversationQuery {
    const now = new Date();
    const session: ConversationSession = {
      sessionId,
      startedAt: now,
      lastActivity: now,
    };

    return new LlmConversationQuery({
      question,
      session,
    });
  }

  /**
   * Creates a conversation query for Slack context
   */
  static createForSlack(
    question: string,
    sessionId: string,
    userId: string,
    channelId: string,
    threadId?: string,
    options?: Partial<
      Omit<
        ConstructorParameters<typeof LlmConversationQuery>[0],
        "message" | "session"
      >
    >,
  ): LlmConversationQuery {
    const now = new Date();
    const session: ConversationSession = {
      sessionId,
      userId,
      channelId,
      threadId,
      startedAt: now,
      lastActivity: now,
      metadata: {
        platform: "slack",
      },
    };

    return new LlmConversationQuery({
      question,
      session,
      ...(options || {}),
    });
  }
}
