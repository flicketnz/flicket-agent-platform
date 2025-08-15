import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ConversationSession } from "src/common/types/conversation-session.type";
import { describe, expect, it, vi } from "vitest";

import { LlmConversationQuery } from "../llm-conversation.query";

describe("LlmConversationQuery", () => {
  const mockSession: ConversationSession = {
    sessionId: "test-session-123",
    userId: "user-456",
    channelId: "channel-789",
    startedAt: new Date("2025-01-01T00:00:00Z"),
    lastActivity: new Date("2025-01-01T00:05:00Z"),
  };

  const mockHistory: (HumanMessage | AIMessage)[] = [
    new HumanMessage("Hello!"),
    new AIMessage("Hi there! How can I help you today?"),
  ];

  it("should create a basic query with required parameters", () => {
    const query = new LlmConversationQuery({
      question: "What is the weather like?",
      session: mockSession,
    });

    expect(query.question).toBe("What is the weather like?");
    expect(query.session).toEqual(mockSession);
  });

  it("should create a query with conversation history", () => {
    const progressCallback = vi.fn();

    const query = new LlmConversationQuery({
      question: "Analyze this data",
      session: mockSession,
      progressCallback,
      systemPrompt: "You are a data analyst.",
    });

    expect(query.question).toBe("Analyze this data");
    expect(query.session).toEqual(mockSession);
    expect(query.progressCallback).toBe(progressCallback);
    expect(query.systemPrompt).toBe("You are a data analyst.");
  });

  it("should create a query using static create method", () => {
    const query = LlmConversationQuery.create("Hello world", "session-123");

    expect(query.question).toBe("Hello world");
    expect(query.session.sessionId).toBe("session-123");
    expect(query.session.startedAt).toBeInstanceOf(Date);
    expect(query.session.lastActivity).toBeInstanceOf(Date);
  });

  it("should create a Slack query using static createForSlack method", () => {
    const query = LlmConversationQuery.createForSlack(
      "Help me with Slack",
      "slack-session-456",
      "user-789",
      "channel-abc",
    );

    expect(query.question).toBe("Help me with Slack");
    expect(query.session.sessionId).toBe("slack-session-456");
    expect(query.session.userId).toBe("user-789");
    expect(query.session.channelId).toBe("channel-abc");
  });

  it("should work with conversation history", () => {
    const query = new LlmConversationQuery({
      question: "Test message",
      session: mockSession,
    });
  });
});
