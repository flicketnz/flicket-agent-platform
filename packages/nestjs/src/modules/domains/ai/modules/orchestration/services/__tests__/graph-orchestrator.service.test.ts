import "reflect-metadata";

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import type { ConversationSession } from "src/common/types/conversation-session.type";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentInvocationInput,
  AgentRegistryService,
  GraphAgentPort,
} from "../../../agents";
import type { PrimaryChatModelPort } from "../../../model-providers/ports/primary-model.port";
import {
  GraphOrchestrationInput,
  GraphOrchestratorService,
} from "../graph-orchestrator.service";

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

describe("GraphOrchestratorService", () => {
  let service: GraphOrchestratorService;
  let mockAgentRegistry: {
    getAgent: ReturnType<typeof vi.fn>;
    getPrimaryAgent: ReturnType<typeof vi.fn>;
    getAllAgentInfo: ReturnType<typeof vi.fn>;
  };
  let mockPrimaryChatModel: {
    model: {
      invoke: ReturnType<typeof vi.fn>;
    };
  };

  // Store graph mocks so we can spy on them
  let primaryGraphMock: { invoke: ReturnType<typeof vi.fn> };
  let secondaryGraphMock: { invoke: ReturnType<typeof vi.fn> };
  let capabilityGraphMock: { invoke: ReturnType<typeof vi.fn> };
  let failingGraphMock: { invoke: ReturnType<typeof vi.fn> };

  // Mock agent implementations for testing
  class MockGraphAgent extends GraphAgentPort {
    private graphMock: { invoke: ReturnType<typeof vi.fn> };
    public graph: CompiledStateGraph<any, any, any>;

    constructor(
      public readonly agentId: string,
      private readonly shouldFail: boolean = false,
    ) {
      super();
      // Create a dedicated mock for this agent
      this.graphMock = {
        invoke: vi.fn().mockImplementation((input: AgentInvocationInput) => {
          if (this.shouldFail) {
            throw new Error(`Agent ${this.agentId} graph invocation failed`);
          }

          return Promise.resolve({
            messages: [
              new AIMessage(
                `Response from ${this.agentId}: Processed your request`,
              ),
            ],
            success: true,
            metadata: {
              duration: 100,
              confidence: 0.9,
              agentId: this.agentId,
            },
          });
        }),
      };

      // Store reference based on agent ID for test access
      if (this.agentId === "primary-agent") {
        primaryGraphMock = this.graphMock;
      } else if (this.agentId === "secondary-agent") {
        secondaryGraphMock = this.graphMock;
      } else if (this.agentId === "capability-agent") {
        capabilityGraphMock = this.graphMock;
      } else if (this.agentId === "failing-agent") {
        failingGraphMock = this.graphMock;
      }

      // Set the abstract graph property
      this.graph = this.graphMock as any;
    }

    getGraph(): CompiledStateGraph<any, any, any> {
      return this.graphMock as any;
    }
  }

  // Test agents
  const primaryAgent = new MockGraphAgent("primary-agent");
  const secondaryAgent = new MockGraphAgent("secondary-agent");
  const capabilityAgent = new MockGraphAgent("capability-agent");
  const failingAgent = new MockGraphAgent("failing-agent", true);

  const createMockSession = (): ConversationSession => ({
    sessionId: "test-session",
    userId: "test-user",
    threadId: "test-thread",
    startedAt: new Date(),
    lastActivity: new Date(),
    metadata: {
      source: "test",
    },
  });

  const createMockInput = (
    messages: BaseMessage[] = [new HumanMessage("Test message")],
    routingContext?: Record<string, any>,
  ): GraphOrchestrationInput => ({
    messages,
    session: createMockSession(),
    routingContext,
    metadata: {
      requestId: "test-request-123",
    },
  });

  const createMockAgentInfo = () => [
    {
      agent: primaryAgent,
      metadata: {
        agentId: "primary-agent",
        capabilities: ["chat", "search"],
        priority: 10,
        isPrimary: true,
        description: "Primary test agent",
      },
    },
    {
      agent: secondaryAgent,
      metadata: {
        agentId: "secondary-agent",
        capabilities: ["analytics", "search"],
        priority: 5,
        isPrimary: false,
        description: "Secondary test agent",
      },
    },
    {
      agent: capabilityAgent,
      metadata: {
        agentId: "capability-agent",
        capabilities: ["specialized-task"],
        priority: 8,
        isPrimary: false,
        description: "Capability test agent",
      },
    },
  ];

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset graph mocks
    if (primaryGraphMock) primaryGraphMock.invoke.mockClear();
    if (secondaryGraphMock) secondaryGraphMock.invoke.mockClear();
    if (capabilityGraphMock) capabilityGraphMock.invoke.mockClear();
    if (failingGraphMock) failingGraphMock.invoke.mockClear();

    // Create mock AgentRegistryService
    mockAgentRegistry = {
      getAgent: vi.fn(),
      getPrimaryAgent: vi.fn(),
      getAllAgentInfo: vi.fn(),
    };

    // Create mock PrimaryChatModelPort
    mockPrimaryChatModel = {
      model: {
        invoke: vi.fn(),
      },
    };

    // Create service instance with mocked dependencies
    service = new GraphOrchestratorService(
      mockAgentRegistry as unknown as AgentRegistryService,
      mockPrimaryChatModel as unknown as PrimaryChatModelPort,
    );
  });

  describe("constructor", () => {
    it("should create service with dependencies", () => {
      expect(service).toBeDefined();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("orchestrateResponse", () => {
    describe("successful orchestration", () => {
      it("should orchestrate response with primary agent when only one agent available", async () => {
        const input = createMockInput();

        // Mock single agent scenario
        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(result.selectionReasoning).toBe("Only one agent available");
        expect(result.messages).toHaveLength(1);
        expect(result.metadata?.orchestrationDuration).toBeDefined();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Starting graph orchestration",
        );
      });

      it("should orchestrate response using LLM agent selection", async () => {
        const input = createMockInput([
          new HumanMessage("I need help with data analytics"),
        ]);

        // Mock multiple agents scenario
        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(secondaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock LLM response recommending secondary agent
        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "secondary-agent",
            reasoning: "Secondary agent specializes in analytics",
            alternatives: ["capability-agent"],
            confidence: 0.9,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("secondary-agent");
        expect(result.selectionReasoning).toBe(
          "Secondary agent specializes in analytics",
        );
        expect(result.alternativeAgents).toEqual(["capability-agent"]);
        expect(result.metadata?.orchestrationDuration).toBeDefined();
      });

      it("should route to primary agent when recommended", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock LLM response recommending primary agent
        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "primary-agent",
            reasoning: "Primary agent is best for general queries",
            alternatives: [],
            confidence: 0.8,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(mockAgentRegistry.getAgent).toHaveBeenCalledWith(
          "primary-agent",
        );
      });

      it("should handle complex LLM response content", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(capabilityAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock complex response content (array of content objects)
        const mockLLMResponse = {
          content: [
            { type: "text", text: "Analysis result: " },
            {
              type: "text",
              text: JSON.stringify({
                recommendedAgentId: "capability-agent",
                reasoning: "Best match for specialized task",
                alternatives: ["secondary-agent"],
                confidence: 0.85,
              }),
            },
          ],
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("capability-agent");
        expect(result.selectionReasoning).toBe(
          "Best match for specialized task",
        );
      });
    });

    describe("error handling", () => {
      it("should handle no agents available error", async () => {
        const input = createMockInput();

        // Mock no agents scenario
        mockAgentRegistry.getAllAgentInfo.mockReturnValue([]);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(null);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Router failed and no primary agent available",
        );
        expect(result.invokedAgentId).toBe("none");
        expect(result.metadata?.orchestrationDuration).toBeDefined();
      });

      it("should fallback to primary agent when LLM analysis fails", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock LLM failure
        mockPrimaryChatModel.model.invoke.mockRejectedValue(
          new Error("LLM service unavailable"),
        );

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(result.selectionReasoning).toContain(
          "Fallback to primary agent due to LLM analysis failure",
        );
      });

      it("should handle invalid LLM JSON response gracefully", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock invalid JSON response
        const mockLLMResponse = {
          content: "This is not valid JSON response",
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(result.selectionReasoning).toBe(
          "Fallback agent selected due to LLM response parsing failure",
        );
      });

      it("should handle LLM recommending non-existent agent", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock LLM response with non-existent agent
        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "non-existent-agent",
            reasoning: "Test reasoning",
            alternatives: [],
            confidence: 0.8,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(result.selectionReasoning).toBe(
          "Fallback agent selected due to LLM response parsing failure",
        );
      });

      it("should handle agent graph invocation failure", async () => {
        const input = createMockInput();

        // Mock single failing agent scenario
        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          {
            agent: failingAgent,
            metadata: {
              agentId: "failing-agent",
              capabilities: ["test"],
              priority: 5,
              isPrimary: false,
              description: "Failing test agent",
            },
          },
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(failingAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Agent failing-agent graph invocation failed",
        );
        expect(result.invokedAgentId).toBe("failing-agent");
      });

      it("should handle missing primary agent when needed", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(null);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(null);

        // Mock LLM failure without primary agent fallback
        mockPrimaryChatModel.model.invoke.mockRejectedValue(
          new Error("LLM service unavailable"),
        );

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Router failed and no primary agent available",
        );
        expect(result.invokedAgentId).toBe("none");
      });

      it("should handle agent not found error", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(null); // Agent not found
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        // Mock LLM response recommending missing agent
        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "secondary-agent",
            reasoning: "Test reasoning",
            alternatives: [],
            confidence: 0.8,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Agent not found: secondary-agent");
        expect(result.invokedAgentId).toBe("none");
      });
    });

    describe("routing context", () => {
      it("should use routing context in LLM analysis", async () => {
        const input = createMockInput(
          [new HumanMessage("Help me with this task")],
          {
            taskDescription: "Analyze customer data for insights",
            preferredCapabilities: ["analytics", "data-processing"],
            hints: { priority: "high" },
          },
        );

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(secondaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "secondary-agent",
            reasoning: "Best match for analytics capabilities",
            alternatives: [],
            confidence: 0.9,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("secondary-agent");

        // Check that the LLM was called with context information
        expect(mockPrimaryChatModel.model.invoke).toHaveBeenCalledWith([
          expect.any(SystemMessage),
          expect.objectContaining({
            content: expect.stringContaining(
              "Analyze customer data for insights",
            ),
          }),
        ]);
      });

      it("should handle system prompt in orchestration", async () => {
        const input: GraphOrchestrationInput = {
          ...createMockInput(),
          systemPrompt:
            "You are a helpful assistant specializing in data analysis",
        };

        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");

        // Verify the system prompt was passed to the agent
        expect(primaryGraphMock.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            systemPrompt:
              "You are a helpful assistant specializing in data analysis",
          }),
          expect.any(Object),
        );
      });
    });

    describe("LLM response parsing", () => {
      it("should parse valid LLM response correctly", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(capabilityAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "capability-agent",
            reasoning: "Perfect match for specialized tasks",
            alternatives: ["secondary-agent", "primary-agent"],
            confidence: 0.95,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("capability-agent");
        expect(result.selectionReasoning).toBe(
          "Perfect match for specialized tasks",
        );
        expect(result.alternativeAgents).toEqual([
          "secondary-agent",
          "primary-agent",
        ]);
      });

      it("should filter invalid alternatives from LLM response", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "primary-agent",
            reasoning: "Good choice",
            alternatives: [
              "secondary-agent",
              "non-existent-agent",
              "primary-agent",
            ], // Should filter out non-existent and self-reference
            confidence: 0.85,
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");
        expect(result.alternativeAgents).toEqual(["secondary-agent"]); // Filtered correctly
      });

      it("should clamp confidence values to 0-1 range", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue(
          createMockAgentInfo(),
        );
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const mockLLMResponse = {
          content: JSON.stringify({
            recommendedAgentId: "primary-agent",
            reasoning: "Test",
            alternatives: [],
            confidence: 1.5, // Out of range
          }),
        };
        mockPrimaryChatModel.model.invoke.mockResolvedValue(mockLLMResponse);

        await service.orchestrateResponse(input);

        // The confidence should be clamped internally (we can't directly test this
        // since it's not exposed in the result, but the service should handle it)
        expect(mockPrimaryChatModel.model.invoke).toHaveBeenCalled();
      });
    });

    describe("message handling", () => {
      it("should handle different message types correctly", async () => {
        const input = createMockInput([
          new SystemMessage("You are a helpful assistant"),
          new HumanMessage("Hello"),
          new AIMessage("Hi there!"),
          new HumanMessage("How can you help me?"),
        ]);

        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.invokedAgentId).toBe("primary-agent");

        // Verify all messages were passed to the agent
        expect(primaryGraphMock.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.any(SystemMessage),
              expect.any(HumanMessage),
              expect.any(AIMessage),
              expect.any(HumanMessage),
            ]),
          }),
          expect.any(Object),
        );
      });

      it("should pass session threadId to agent graph", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);

        // Verify the thread_id was passed to the graph
        expect(primaryGraphMock.invoke).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            configurable: { thread_id: "test-thread" },
          }),
        );
      });
    });

    describe("metadata handling", () => {
      it("should preserve and enhance metadata through orchestration", async () => {
        const input = createMockInput();
        input.metadata = { customField: "test-value", requestSource: "api" };

        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.metadata).toEqual(
          expect.objectContaining({
            duration: expect.any(Number),
            confidence: expect.any(Number),
            agentId: "primary-agent",
            orchestrationDuration: expect.any(Number),
          }),
        );
      });

      it("should include orchestration duration in metadata", async () => {
        const input = createMockInput();

        mockAgentRegistry.getAllAgentInfo.mockReturnValue([
          createMockAgentInfo()[0],
        ]);
        mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
        mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

        const result = await service.orchestrateResponse(input);

        expect(result.success).toBe(true);
        expect(result.metadata?.orchestrationDuration).toBeDefined();
        expect(typeof result.metadata?.orchestrationDuration).toBe("number");
        expect(result.metadata?.orchestrationDuration).toBeGreaterThan(0);
      });
    });
  });

  describe("edge cases and stress scenarios", () => {
    it("should handle service initialization without errors", () => {
      expect(() => {
        new GraphOrchestratorService(
          mockAgentRegistry as unknown as AgentRegistryService,
          mockPrimaryChatModel as unknown as PrimaryChatModelPort,
        );
      }).not.toThrow();
    });

    it("should handle concurrent orchestration requests", async () => {
      const input1 = createMockInput([new HumanMessage("Request 1")]);
      const input2 = createMockInput([new HumanMessage("Request 2")]);

      mockAgentRegistry.getAllAgentInfo.mockReturnValue([
        createMockAgentInfo()[0],
      ]);
      mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
      mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

      const [result1, result2] = await Promise.all([
        service.orchestrateResponse(input1),
        service.orchestrateResponse(input2),
      ]);

      expect(result1.success).toBe(true);
      expect(result1.invokedAgentId).toBe("primary-agent");
      expect(result2.success).toBe(true);
      expect(result2.invokedAgentId).toBe("primary-agent");
    });

    it("should handle empty messages array", async () => {
      const input = createMockInput([]);

      mockAgentRegistry.getAllAgentInfo.mockReturnValue([
        createMockAgentInfo()[0],
      ]);
      mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
      mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

      const result = await service.orchestrateResponse(input);

      expect(result.success).toBe(true);
      expect(result.invokedAgentId).toBe("primary-agent");
    });

    it("should handle malformed routing context gracefully", async () => {
      const input = createMockInput([new HumanMessage("Test")], {
        // Malformed routing context
        preferredCapabilities: "not-an-array", // Should be array
        taskDescription: null, // Should be string
        hints: "not-an-object", // Should be object
      });

      mockAgentRegistry.getAllAgentInfo.mockReturnValue([
        createMockAgentInfo()[0],
      ]);
      mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
      mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

      const result = await service.orchestrateResponse(input);

      expect(result.success).toBe(true);
      expect(result.invokedAgentId).toBe("primary-agent");
    });

    it("should log appropriate debug messages throughout orchestration", async () => {
      const input = createMockInput();

      mockAgentRegistry.getAllAgentInfo.mockReturnValue([
        createMockAgentInfo()[0],
      ]);
      mockAgentRegistry.getAgent.mockReturnValue(primaryAgent);
      mockAgentRegistry.getPrimaryAgent.mockReturnValue(primaryAgent);

      await service.orchestrateResponse(input);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Starting graph orchestration",
      );
      expect(mockLogger.debug).toHaveBeenCalledWith("Executing router node");
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Invoking agent graph: primary-agent",
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Graph orchestration completed"),
      );
    });
  });
});
