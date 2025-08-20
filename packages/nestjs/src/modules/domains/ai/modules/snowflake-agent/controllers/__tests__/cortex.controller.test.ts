/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import "reflect-metadata";

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { ConversationSession } from "src/common/types/conversation-session.type";
import type { AuthenticatedRequest } from "src/modules/auth/types/auth.types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SnowflakeCortexAgentAdapter } from "../../adapters/snowflake-cortex.agent";
import { CortexController } from "../cortex.controller";
import type { CortexChatRequestDto } from "../dtos/cortex.dto";

// Create a mock logger instance that can be spied on
const mockLogger = {
  log: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock the Logger class to return our mock instance
vi.mock("@nestjs/common", async () => {
  const actual = await vi.importActual("@nestjs/common");
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => mockLogger),
  };
});

// Helper functions available to all tests
const createMockRequest = (userId?: string): AuthenticatedRequest =>
  ({
    user: userId ? { sub: userId } : undefined,
    headers: { "user-agent": "test-agent" },
    ip: "127.0.0.1",
  }) as AuthenticatedRequest;

const createBasicChatRequest = (): CortexChatRequestDto => ({
  sessionId: "test-session-123",
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
    { role: "user", content: "How are you?" },
  ],
  userId: "user-123",
});

const createSuccessfulGraphResult = () => ({
  messages: [new AIMessage("I'm doing well, thank you!")],
});

describe("CortexController", () => {
  let controller: CortexController;
  let mockSnowflakeCortexAgent: {
    getGraph: ReturnType<typeof vi.fn>;
    agentId: string;
  };
  let mockGraph: {
    invoke: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock graph with invoke method
    mockGraph = {
      invoke: vi.fn(),
    };

    // Create mock SnowflakeCortexAgentAdapter
    mockSnowflakeCortexAgent = {
      getGraph: vi.fn().mockReturnValue(mockGraph),
      agentId: "snowflake-cortex",
    };

    // Create controller instance with mocked dependencies
    controller = new CortexController(
      mockSnowflakeCortexAgent as unknown as SnowflakeCortexAgentAdapter,
    );
  });

  describe("constructor", () => {
    it("should create controller with agent", () => {
      expect(controller).toBeDefined();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should warn when agent is not available", () => {
      const controllerWithoutAgent = new CortexController(null as any);
      expect(controllerWithoutAgent).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "SnowflakeCortexAgentAdapter is not available - agent may be disabled in configuration",
      );
    });
  });

  describe("POST /agents/cortex/chat", () => {
    it("should handle successful chat request with message conversion", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(mockSnowflakeCortexAgent.getGraph).toHaveBeenCalled();
      expect(mockGraph.invoke).toHaveBeenCalledWith({
        messages: expect.arrayContaining([
          expect.any(HumanMessage),
          expect.any(AIMessage),
          expect.any(HumanMessage),
        ]),
        session: expect.objectContaining({
          sessionId: "test-session-123",
          userId: "user-123",
          startedAt: expect.any(Date),
          lastActivity: expect.any(Date),
          metadata: expect.objectContaining({
            source: "cortex-controller",
            userAgent: "test-agent",
            ip: "127.0.0.1",
          }),
        }),
        context: undefined,
        systemPrompt: undefined,
        metadata: expect.objectContaining({
          requestId: expect.stringContaining("cortex-"),
          userId: "user-123",
          sessionId: "test-session-123",
        }),
      });

      expect(result).toEqual({
        messages: [
          { role: "assistant", content: "I'm doing well, thank you!" },
        ],
        success: undefined,
        metadata: expect.objectContaining({
          duration: expect.any(Number),
        }),
        error: undefined,
        nextSuggestedAgent: undefined,
      });
    });

    it("should handle chat request with context and metadata", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-session-456",
        messages: [{ role: "user", content: "Analyze my data" }],
        userId: "user-456",
        context: { dataset: "sales_2024", filters: { region: "US" } },
        systemPrompt: "You are a data analyst assistant.",
      };
      const mockRequest = createMockRequest("user-456");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(mockGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { dataset: "sales_2024", filters: { region: "US" } },
          systemPrompt: "You are a data analyst assistant.",
        }),
      );

      expect(result.success).toBeUndefined(); // Graph result doesn't have success field
    });

    it("should handle chat request with multiple message types", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-session-789",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
          { role: "user", content: "What can you do?" },
        ],
        userId: "user-789",
      };
      const mockRequest = createMockRequest("user-789");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      const invokeCall = mockGraph.invoke.mock.calls[0][0];
      const messages = invokeCall.messages;

      expect(messages).toHaveLength(4);
      expect(messages[0]).toBeInstanceOf(SystemMessage);
      expect(messages[1]).toBeInstanceOf(HumanMessage);
      expect(messages[2]).toBeInstanceOf(AIMessage);
      expect(messages[3]).toBeInstanceOf(HumanMessage);
    });

    it("should extract user ID from JWT payload when not in request", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-session-jwt",
        messages: [{ role: "user", content: "Hello" }],
        // No userId in request
      };
      const mockRequest = createMockRequest("jwt-user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      const invokeCall = mockGraph.invoke.mock.calls[0][0];

      expect(invokeCall.session.userId).toBe("jwt-user-123");
      expect(invokeCall.metadata.userId).toBe("jwt-user-123");
    });

    it("should prioritize JWT payload over request userId", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-session-priority",
        messages: [{ role: "user", content: "Hello" }],
        userId: "request-user-456",
      };
      const mockRequest = createMockRequest("jwt-user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      const invokeCall = mockGraph.invoke.mock.calls[0][0];
      // Controller logic: const userId = req.user?.sub || request.userId;
      // JWT payload should take priority
      expect(invokeCall.session.userId).toBe("jwt-user-123");
      expect(invokeCall.metadata.userId).toBe("jwt-user-123");
    });

    it("should handle agent unavailable error", async () => {
      const controllerWithoutAgent = new CortexController(null as any);
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      await expect(
        controllerWithoutAgent.chat(request, mockRequest),
      ).rejects.toThrow(HttpException);

      try {
        await controllerWithoutAgent.chat(request, mockRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.SERVICE_UNAVAILABLE,
        );
        expect((error as HttpException).message).toBe(
          "Snowflake Cortex agent is not available",
        );
      }
    });

    it("should handle graph invocation exception gracefully", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      mockGraph.invoke.mockRejectedValue(new Error("Network timeout"));

      const result = await controller.chat(request, mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
      expect(result.messages).toEqual([]);
      expect(result.metadata?.duration).toBeDefined();
    });

    it("should handle unknown error types", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      mockGraph.invoke.mockRejectedValue("String error");

      const result = await controller.chat(request, mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown error occurred");
    });

    it("should create proper session object from request", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      const invokeCall = mockGraph.invoke.mock.calls[0][0];
      const session: ConversationSession = invokeCall.session;

      expect(session).toEqual({
        sessionId: "test-session-123",
        userId: "user-123",
        startedAt: expect.any(Date),
        lastActivity: expect.any(Date),
        metadata: {
          source: "cortex-controller",
          userAgent: "test-agent",
          ip: "127.0.0.1",
        },
      });
    });

    it("should preserve graph result and add duration", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = {
        messages: [new AIMessage("Response")],
        metadata: {
          customField: "customValue",
        },
      };

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(result.metadata).toEqual(
        expect.objectContaining({
          duration: expect.any(Number),
          customField: "customValue",
        }),
      );
    });
  });

  describe("GET /agents/cortex/health", () => {
    it("should return basic health status when agent is available", () => {
      const mockRequest = createMockRequest("user-123");

      const result = controller.health(mockRequest);

      expect(result).toEqual({
        agentId: "snowflake-cortex",
      });
    });

    it("should handle agent not available", () => {
      const controllerWithoutAgent = new CortexController(null as any);
      const mockRequest = createMockRequest("user-123");

      const result = controllerWithoutAgent.health(mockRequest);

      expect(result).toEqual({
        healthy: false,
        status: "Snowflake Cortex agent is not available or disabled",
        agentId: "snowflake-cortex",
        version: "unknown",
        capabilities: [],
      });
    });
  });

  describe("Message Conversion", () => {
    it("should convert REST messages to LangChain messages correctly", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-conversion",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        userId: "user-123",
      };
      const mockRequest = createMockRequest("user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      const invokeCall = mockGraph.invoke.mock.calls[0][0];
      const messages: BaseMessage[] = invokeCall.messages;

      expect(messages[0]).toBeInstanceOf(SystemMessage);
      expect(messages[0].content).toBe("You are helpful.");
      expect(messages[1]).toBeInstanceOf(HumanMessage);
      expect(messages[1].content).toBe("Hello");
      expect(messages[2]).toBeInstanceOf(AIMessage);
      expect(messages[2].content).toBe("Hi there!");
    });

    it("should convert LangChain messages to REST format correctly", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = {
        messages: [
          new SystemMessage("System response"),
          new HumanMessage("User message"),
          new AIMessage("Assistant response"),
        ],
      };

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(result.messages).toEqual([
        { role: "system", content: "System response" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant response" },
      ]);
    });

    it("should handle complex message content", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = {
        messages: [new AIMessage("Complex response with data")],
      };

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(result.messages[0].content).toBe("Complex response with data");
    });

    it("should handle unknown message types gracefully", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      // Create a mock message with unknown type
      const unknownMessage = {
        getType: () => "unknown",
        content: "Unknown message",
      } as unknown as BaseMessage;

      const graphResult = {
        messages: [unknownMessage],
      };

      mockGraph.invoke.mockResolvedValue(graphResult);

      const result = await controller.chat(request, mockRequest);

      expect(result.messages[0]).toEqual({
        role: "assistant", // Default fallback
        content: "Unknown message",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Unknown message type: unknown, defaulting to assistant",
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle unsupported message roles", async () => {
      const request: CortexChatRequestDto = {
        sessionId: "test-session",
        messages: [{ role: "unsupported" as any, content: "Invalid role" }],
        userId: "user-123",
      };
      const mockRequest = createMockRequest("user-123");

      const result = await controller.chat(request, mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported message role");
    });

    it("should handle HttpException passthrough", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      const httpException = new HttpException(
        "Service unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      mockGraph.invoke.mockRejectedValue(httpException);

      await expect(controller.chat(request, mockRequest)).rejects.toThrow(
        HttpException,
      );
    });

    it("should log appropriate messages for successful and failed requests", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");
      const graphResult = createSuccessfulGraphResult();

      mockGraph.invoke.mockResolvedValue(graphResult);

      await controller.chat(request, mockRequest);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Chat request from user user-123"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Invoking Snowflake Cortex agent"),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Chat response for user user-123"),
      );
    });

    it("should log errors for failed requests", async () => {
      const request = createBasicChatRequest();
      const mockRequest = createMockRequest("user-123");

      mockGraph.invoke.mockRejectedValue(new Error("Test error"));

      await controller.chat(request, mockRequest);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Chat request failed"),
        expect.any(String),
      );
    });
  });
});
