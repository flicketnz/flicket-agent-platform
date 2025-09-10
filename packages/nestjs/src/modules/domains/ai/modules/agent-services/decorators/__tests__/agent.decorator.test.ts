import "reflect-metadata";

import { beforeEach, describe, expect, it } from "vitest";

import {
  Agent,
  AgentMetadata,
  getAgentMetadata,
  isAgent,
} from "../agent.decorator";

describe("Agent Decorator", () => {
  // Clean up metadata between tests
  beforeEach(() => {
    // Clear any existing metadata to ensure test isolation
  });

  describe("@Agent decorator", () => {
    it("should store metadata correctly on a class with minimal configuration", () => {
      const metadata: AgentMetadata = {
        agentId: "test-agent",
        capabilities: ["chat", "search"],
      };

      @Agent(metadata)
      class TestAgent {}

      const retrievedMetadata = getAgentMetadata(TestAgent);
      expect(retrievedMetadata).toEqual(metadata);
    });

    it("should store metadata correctly with complex capability arrays", () => {
      const metadata: AgentMetadata = {
        agentId: "complex-agent",
        capabilities: [
          "natural-language-processing",
          "machine-learning",
          "data-analysis",
          "real-time-chat",
          "file-processing",
        ],
      };

      @Agent(metadata)
      class ComplexAgent {}

      const retrievedMetadata = getAgentMetadata(ComplexAgent);
      expect(retrievedMetadata).toEqual(metadata);
      expect(retrievedMetadata?.capabilities).toHaveLength(5);
    });
  });

  describe("getAgentMetadata", () => {
    it("should retrieve correct metadata from a decorated class", () => {
      const expectedMetadata: AgentMetadata = {
        agentId: "retrieval-test",
        capabilities: ["test-capability"],
      };

      @Agent(expectedMetadata)
      class RetrievalTestAgent {}

      const metadata = getAgentMetadata(RetrievalTestAgent);
      expect(metadata).toBeDefined();
      expect(metadata).toEqual(expectedMetadata);
    });

    it("should return undefined for non-decorated classes", () => {
      class NonDecoratedAgent {}

      const metadata = getAgentMetadata(NonDecoratedAgent);
      expect(metadata).toBeUndefined();
    });

    it("should return undefined for non-class objects", () => {
      const plainObject = {};
      const functionObject = () => {};

      expect(getAgentMetadata(plainObject)).toBeUndefined();
      expect(getAgentMetadata(functionObject)).toBeUndefined();
    });

    it("should handle classes with other decorators but no Agent decorator", () => {
      // Simulate a class with other metadata
      class OtherDecoratedClass {}
      Reflect.defineMetadata(
        "some-other-key",
        "some-value",
        OtherDecoratedClass,
      );

      const metadata = getAgentMetadata(OtherDecoratedClass);
      expect(metadata).toBeUndefined();
    });
  });

  describe("isAgent", () => {
    it("should return true for classes decorated with @Agent", () => {
      @Agent({
        agentId: "is-agent-test",
        capabilities: ["testing"],
      })
      class DecoratedAgent {}

      expect(isAgent(DecoratedAgent)).toBe(true);
    });

    it("should return false for non-decorated classes", () => {
      class NonDecoratedAgent {}

      expect(isAgent(NonDecoratedAgent)).toBe(false);
    });

    it("should return false for non-class objects", () => {
      const plainObject = {};
      const functionObject = () => {};

      expect(isAgent(plainObject)).toBe(false);
      expect(isAgent(functionObject)).toBe(false);
    });

    it("should return false for classes with other decorators but no Agent decorator", () => {
      class OtherDecoratedClass {}
      Reflect.defineMetadata(
        "some-other-key",
        "some-value",
        OtherDecoratedClass,
      );

      expect(isAgent(OtherDecoratedClass)).toBe(false);
    });

    it("should work correctly for multiple decorated classes", () => {
      @Agent({
        agentId: "agent-1",
        capabilities: ["cap1"],
      })
      class Agent1 {}

      @Agent({
        agentId: "agent-2",
        capabilities: ["cap2"],
      })
      class Agent2 {}

      class NonAgent {}

      expect(isAgent(Agent1)).toBe(true);
      expect(isAgent(Agent2)).toBe(true);
      expect(isAgent(NonAgent)).toBe(false);
    });
  });

  describe("Agent.KEY", () => {
    it("should have a properly defined decorator key", () => {
      expect(Agent.KEY).toBeDefined();
      expect(typeof Agent.KEY).toBe("string");
    });

    it("should use the same key for metadata storage and retrieval", () => {
      const metadata: AgentMetadata = {
        agentId: "key-test",
        capabilities: ["testing"],
      };

      @Agent(metadata)
      class KeyTestAgent {}

      // Verify the key is used consistently
      const directMetadata = Reflect.getMetadata(Agent.KEY, KeyTestAgent) as
        | AgentMetadata
        | undefined;
      const helperMetadata = getAgentMetadata(KeyTestAgent);

      expect(directMetadata).toEqual(helperMetadata);
      expect(directMetadata).toEqual(metadata);
    });
  });

  describe("Metadata validation scenarios", () => {
    it("should preserve exact agentId strings", () => {
      const specialIds = [
        "agent-with-dashes",
        "agent_with_underscores",
        "agent.with.dots",
        "Agent123",
        "UPPERCASE_AGENT",
      ];

      specialIds.forEach((agentId) => {
        @Agent({
          agentId,
          capabilities: ["test"],
        })
        class TestAgent {}

        const metadata = getAgentMetadata(TestAgent);
        expect(metadata?.agentId).toBe(agentId);
      });
    });

    it("should preserve capability strings exactly", () => {
      const capabilities = [
        "simple",
        "with-dashes",
        "with_underscores",
        "with.dots",
        "CamelCase",
        "UPPERCASE",
        "mixed-Case_Example.test",
      ];

      @Agent({
        agentId: "capability-test",
        capabilities,
      })
      class CapabilityTestAgent {}

      const metadata = getAgentMetadata(CapabilityTestAgent);
      expect(metadata?.capabilities).toEqual(capabilities);
    });
  });

  describe("Multiple decorations on same class", () => {
    it("should work with other NestJS decorators", () => {
      // Simulate having other decorators on the same class
      const otherDecoratorKey = Symbol("other-decorator");

      @Agent({
        agentId: "multi-decorated",
        capabilities: ["multi"],
      })
      class MultiDecoratedAgent {}

      // Add another decorator's metadata
      Reflect.defineMetadata(
        otherDecoratorKey,
        "other-value",
        MultiDecoratedAgent,
      );

      // Agent decorator should still work
      expect(isAgent(MultiDecoratedAgent)).toBe(true);
      const metadata = getAgentMetadata(MultiDecoratedAgent);
      expect(metadata?.agentId).toBe("multi-decorated");

      // Other metadata should also be preserved
      const otherMetadata = Reflect.getMetadata(
        otherDecoratorKey,
        MultiDecoratedAgent,
      ) as string;
      expect(otherMetadata).toBe("other-value");
    });
  });
});
