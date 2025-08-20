import "reflect-metadata";

import { StateGraph } from "@langchain/langgraph";
import { DiscoveryService } from "@nestjs/core";
import { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../../decorators/agent.decorator";
import { GraphAgentPort } from "../../ports/graph-agent.port";
import { AgentRegistryService } from "../agent-registry.service";

// Define a simple state for the graph
interface AgentState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

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

describe("AgentRegistryService", () => {
  let service: AgentRegistryService;
  let mockDiscoveryService: {
    getProviders: ReturnType<typeof vi.fn>;
    getMetadataByDecorator: ReturnType<typeof vi.fn>;
  };

  // Mock agent implementations for testing
  @Agent({
    agentId: "primary-agent",
    capabilities: ["chat", "search"],
  })
  class MockPrimaryAgent extends GraphAgentPort {
    readonly agentId = "primary-agent";
    protected readonly graph = new StateGraph<AgentState>({
      channels: {},
    }).compile();

    getGraph() {
      return this.graph;
    }
  }

  @Agent({
    agentId: "secondary-agent",
    capabilities: ["analytics", "search"],
  })
  class MockSecondaryAgent extends GraphAgentPort {
    readonly agentId = "secondary-agent";
    protected readonly graph = new StateGraph<AgentState>({
      channels: {},
    }).compile();

    getGraph() {
      return this.graph;
    }
  }

  @Agent({
    agentId: "low-priority-agent",
    capabilities: ["basic"],
  })
  class MockLowPriorityAgent extends GraphAgentPort {
    readonly agentId = "low-priority-agent";
    protected readonly graph = new StateGraph<AgentState>({
      channels: {},
    }).compile();

    getGraph() {
      return this.graph;
    }
  }

  @Agent({
    agentId: "duplicate-primary",
    capabilities: ["chat"],
  })
  class MockDuplicatePrimaryAgent extends GraphAgentPort {
    readonly agentId = "duplicate-primary";
    protected readonly graph = new StateGraph<AgentState>({
      channels: {},
    }).compile();

    getGraph() {
      return this.graph;
    }
  }

  // Invalid agent without proper interface implementation
  @Agent({
    agentId: "invalid-agent",
    capabilities: ["test"],
  })
  class MockInvalidAgent {
    // Missing required agentId property and getGraph method
  }

  // Agent without decorator for testing edge cases
  class MockNonDecoratedAgent extends GraphAgentPort {
    readonly agentId = "non-decorated";
    protected readonly graph = new StateGraph<AgentState>({
      channels: {},
    }).compile();

    getGraph() {
      return this.graph;
    }
  }

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock DiscoveryService
    mockDiscoveryService = {
      getProviders: vi.fn(),
      getMetadataByDecorator: vi.fn(),
    };

    // Create service instance with mocked dependencies
    service = new AgentRegistryService(
      mockDiscoveryService as unknown as DiscoveryService,
    );
  });

  describe("onModuleInit", () => {
    it("should discover and register agents successfully", () => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        });

      service.onModuleInit();

      expect(mockDiscoveryService.getProviders).toHaveBeenCalled();
      expect(service.getAllAgents().size).toBe(2);
      expect(service.getAgent("primary-agent")).toBe(primaryAgent);
      expect(service.getAgent("secondary-agent")).toBe(secondaryAgent);
    });

    it("should skip agents without metadata", () => {
      const primaryAgent = new MockPrimaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockReturnValue(undefined);

      service.onModuleInit();

      expect(service.getAllAgents().size).toBe(0);
    });

    it("should skip invalid agent implementations", () => {
      const invalidAgent = new MockInvalidAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockInvalidAgent",
          instance: invalidAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockReturnValue({
        agentId: "invalid-agent",
        capabilities: ["test"],
      });

      service.onModuleInit();

      expect(service.getAllAgents().size).toBe(0);
    });

    it("should skip duplicate agent IDs", () => {
      const agent1 = new MockPrimaryAgent();
      const agent2 = new MockPrimaryAgent(); // Same agentId

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent1",
          instance: agent1,
        } as InstanceWrapper,
        {
          name: "MockPrimaryAgent2",
          instance: agent2,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "primary-agent", // Duplicate ID
          capabilities: ["chat", "search"],
        });

      service.onModuleInit();

      expect(service.getAllAgents().size).toBe(1);
    });

    it("should handle registration errors gracefully", () => {
      const mockWrappers: InstanceWrapper[] = [
        {
          name: "ErrorAgent",
          instance: null,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockImplementation(() => {
        throw new Error("Metadata error");
      });

      expect(() => service.onModuleInit()).not.toThrow();
      expect(service.getAllAgents().size).toBe(0);
    });
  });

  describe("getAgent", () => {
    beforeEach(() => {
      const primaryAgent = new MockPrimaryAgent();
      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockReturnValue({
        agentId: "primary-agent",
        capabilities: ["chat", "search"],
      });

      service.onModuleInit();
    });

    it("should return correct agent by ID", () => {
      const agent = service.getAgent("primary-agent");
      expect(agent).toBeDefined();
      if (agent) {
        expect(agent.agentId).toBe("primary-agent");
      }
    });

    it("should return undefined for non-existent agent", () => {
      const agent = service.getAgent("non-existent");
      expect(agent).toBeUndefined();
    });
  });

  describe("getAllAgents", () => {
    it("should return all registered agents", () => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        });

      service.onModuleInit();

      const allAgents = service.getAllAgents();
      expect(allAgents.size).toBe(2);
      expect(allAgents.has("primary-agent")).toBe(true);
      expect(allAgents.has("secondary-agent")).toBe(true);
    });

    it("should return empty map when no agents registered", () => {
      mockDiscoveryService.getProviders.mockReturnValue([]);
      service.onModuleInit();

      const allAgents = service.getAllAgents();
      expect(allAgents.size).toBe(0);
    });
  });

  describe("getAgentsByCapability", () => {
    beforeEach(() => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();
      const lowPriorityAgent = new MockLowPriorityAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
        {
          name: "MockLowPriorityAgent",
          instance: lowPriorityAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        })
        .mockReturnValueOnce({
          agentId: "low-priority-agent",
          capabilities: ["basic"],
        });

      service.onModuleInit();
    });

    it("should filter agents by capability correctly", () => {
      const searchAgents = service.getAgentsByCapability("search");
      expect(searchAgents).toHaveLength(2);
      const agentIds = searchAgents.map((a) => a.agentId);
      expect(agentIds).toContain("primary-agent");
      expect(agentIds).toContain("secondary-agent");
    });

    it("should return empty array for non-existent capability", () => {
      const agents = service.getAgentsByCapability("non-existent");
      expect(agents).toHaveLength(0);
    });

    it("should return single agent for unique capability", () => {
      const basicAgents = service.getAgentsByCapability("basic");
      expect(basicAgents).toHaveLength(1);
      if (basicAgents[0]) {
        expect(basicAgents[0].agentId).toBe("low-priority-agent");
      }
    });
  });

  describe("getPrimaryAgent", () => {
    it("should return undefined when no primary agent marker exists in current implementation", () => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        });

      service.onModuleInit();

      // Since the new decorator doesn't support isPrimary, this should return undefined
      const primary = service.getPrimaryAgent();
      expect(primary).toBeUndefined();
    });
  });

  describe("getAgentMetadata", () => {
    beforeEach(() => {
      const primaryAgent = new MockPrimaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockReturnValue({
        agentId: "primary-agent",
        capabilities: ["chat", "search"],
      });

      service.onModuleInit();
    });

    it("should return correct metadata for existing agent", () => {
      const metadata = service.getAgentMetadata("primary-agent");
      expect(metadata).toBeDefined();
      expect(metadata?.agentId).toBe("primary-agent");
      expect(metadata?.capabilities).toEqual(["chat", "search"]);
      // Should not have old properties
      expect(metadata?.isPrimary).toBeUndefined();
      expect(metadata?.priority).toBeUndefined();
      expect(metadata?.description).toBeUndefined();
    });

    it("should return undefined for non-existent agent", () => {
      const metadata = service.getAgentMetadata("non-existent");
      expect(metadata).toBeUndefined();
    });
  });

  describe("getSortedAgentsByPriority", () => {
    beforeEach(() => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();
      const lowPriorityAgent = new MockLowPriorityAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockLowPriorityAgent",
          instance: lowPriorityAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "low-priority-agent",
          capabilities: ["basic"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        })
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        });

      service.onModuleInit();
    });

    it("should sort agents by agentId since priority is no longer supported", () => {
      const sortedAgents = service.getSortedAgentsByPriority();
      expect(sortedAgents).toHaveLength(3);
      if (sortedAgents[0] && sortedAgents[1] && sortedAgents[2]) {
        // Should be sorted alphabetically by agentId since priority is not available
        expect(sortedAgents[0].agentId).toBe("low-priority-agent");
        expect(sortedAgents[1].agentId).toBe("primary-agent");
        expect(sortedAgents[2].agentId).toBe("secondary-agent");
      }
    });

    it("should handle agents without priority gracefully", () => {
      @Agent({
        agentId: "no-priority-agent",
        capabilities: ["test"],
      })
      class MockNoPriorityAgent extends GraphAgentPort {
        readonly agentId = "no-priority-agent";
        protected readonly graph = new StateGraph<AgentState>({
          channels: {},
        }).compile();

        getGraph() {
          return this.graph;
        }
      }

      const noPriorityAgent = new MockNoPriorityAgent();
      const lowPriorityAgent = new MockLowPriorityAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockNoPriorityAgent",
          instance: noPriorityAgent,
        } as InstanceWrapper,
        {
          name: "MockLowPriorityAgent",
          instance: lowPriorityAgent,
        } as InstanceWrapper,
      ];

      const newService = new AgentRegistryService(
        mockDiscoveryService as unknown as DiscoveryService,
      );
      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "no-priority-agent",
          capabilities: ["test"],
        })
        .mockReturnValueOnce({
          agentId: "low-priority-agent",
          capabilities: ["basic"],
        });

      newService.onModuleInit();

      const sortedAgents = newService.getSortedAgentsByPriority();
      expect(sortedAgents).toHaveLength(2);
      if (sortedAgents[0] && sortedAgents[1]) {
        // Should be sorted alphabetically by agentId
        expect(sortedAgents[0].agentId).toBe("low-priority-agent");
        expect(sortedAgents[1].agentId).toBe("no-priority-agent");
      }
    });

    it("should sort by agentId alphabetically", () => {
      @Agent({
        agentId: "agent-b",
        capabilities: ["test"],
      })
      class MockAgentB extends GraphAgentPort {
        readonly agentId = "agent-b";
        protected readonly graph = new StateGraph<AgentState>({
          channels: {},
        }).compile();

        getGraph() {
          return this.graph;
        }
      }

      @Agent({
        agentId: "agent-a",
        capabilities: ["test"],
      })
      class MockAgentA extends GraphAgentPort {
        readonly agentId = "agent-a";
        protected readonly graph = new StateGraph<AgentState>({
          channels: {},
        }).compile();

        getGraph() {
          return this.graph;
        }
      }

      const agentB = new MockAgentB();
      const agentA = new MockAgentA();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockAgentB",
          instance: agentB,
        } as InstanceWrapper,
        {
          name: "MockAgentA",
          instance: agentA,
        } as InstanceWrapper,
      ];

      const newService = new AgentRegistryService(
        mockDiscoveryService as unknown as DiscoveryService,
      );
      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "agent-b",
          capabilities: ["test"],
        })
        .mockReturnValueOnce({
          agentId: "agent-a",
          capabilities: ["test"],
        });

      newService.onModuleInit();

      const sortedAgents = newService.getSortedAgentsByPriority();
      expect(sortedAgents).toHaveLength(2);
      if (sortedAgents[0] && sortedAgents[1]) {
        expect(sortedAgents[0].agentId).toBe("agent-a");
        expect(sortedAgents[1].agentId).toBe("agent-b");
      }
    });
  });

  describe("getAllAgentInfo", () => {
    beforeEach(() => {
      const primaryAgent = new MockPrimaryAgent();
      const secondaryAgent = new MockSecondaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockPrimaryAgent",
          instance: primaryAgent,
        } as InstanceWrapper,
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator
        .mockReturnValueOnce({
          agentId: "primary-agent",
          capabilities: ["chat", "search"],
        })
        .mockReturnValueOnce({
          agentId: "secondary-agent",
          capabilities: ["analytics", "search"],
        });

      service.onModuleInit();
    });

    it("should return agent and metadata pairs", () => {
      const agentInfo = service.getAllAgentInfo();
      expect(agentInfo).toHaveLength(2);

      const primaryInfo = agentInfo.find(
        (info) => info.metadata.agentId === "primary-agent",
      );
      expect(primaryInfo).toBeDefined();
      if (primaryInfo) {
        expect(primaryInfo.agent.agentId).toBe("primary-agent");
        expect(primaryInfo.metadata.capabilities).toEqual(["chat", "search"]);
        expect(primaryInfo.metadata.isPrimary).toBeUndefined();
      }

      const secondaryInfo = agentInfo.find(
        (info) => info.metadata.agentId === "secondary-agent",
      );
      expect(secondaryInfo).toBeDefined();
      if (secondaryInfo) {
        expect(secondaryInfo.agent.agentId).toBe("secondary-agent");
        expect(secondaryInfo.metadata.capabilities).toEqual([
          "analytics",
          "search",
        ]);
        expect(secondaryInfo.metadata.isPrimary).toBeUndefined();
      }
    });

    it("should return empty array when no agents registered", () => {
      const newService = new AgentRegistryService(
        mockDiscoveryService as unknown as DiscoveryService,
      );
      mockDiscoveryService.getProviders.mockReturnValue([]);
      newService.onModuleInit();

      const agentInfo = newService.getAllAgentInfo();
      expect(agentInfo).toHaveLength(0);
    });
  });

  describe("validatePrimaryAgentConfiguration", () => {
    it("should not log warning when no primary agent exists since isPrimary is no longer supported", () => {
      const secondaryAgent = new MockSecondaryAgent();

      const mockWrappers: InstanceWrapper[] = [
        {
          name: "MockSecondaryAgent",
          instance: secondaryAgent,
        } as InstanceWrapper,
      ];

      mockDiscoveryService.getProviders.mockReturnValue(mockWrappers);
      mockDiscoveryService.getMetadataByDecorator.mockReturnValue({
        agentId: "secondary-agent",
        capabilities: ["analytics", "search"],
      });

      service.onModuleInit();

      // Since isPrimary is no longer supported, no warning should be logged
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("primary agent"),
      );
    });
  });
});
