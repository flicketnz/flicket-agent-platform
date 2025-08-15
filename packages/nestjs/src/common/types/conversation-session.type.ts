/**
 * Session context for maintaining conversation state
 */
export interface ConversationSession {
  sessionId: string;
  userId?: string;
  channelId?: string;
  threadId?: string;
  startedAt: Date;
  lastActivity: Date;
  metadata?: Record<string, any>;
}
