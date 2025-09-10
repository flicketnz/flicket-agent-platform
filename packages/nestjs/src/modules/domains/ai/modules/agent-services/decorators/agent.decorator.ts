import "reflect-metadata";

import { DiscoveryService } from "@nestjs/core";

/**
 * Metadata interface for Agent decorator
 */
export interface AgentMetadata {
  /** Unique identifier for the agent */
  agentId: string;
  /** List of capabilities this agent provides */
  capabilities: string[];
  /** Description of what this agent does */
  description?: string;
  /** Whether this agent is the primary/default agent */
  isPrimary?: boolean;
  /** Priority level for agent selection (higher number = higher priority) */
  priority?: number;
}

/**
 * Agent decorator that marks a class as an AI agent with metadata
 */
export const Agent = DiscoveryService.createDecorator<AgentMetadata>();

/**
 * Helper function to retrieve agent metadata from a class
 *
 * @param target - The class to retrieve metadata from
 * @returns Agent metadata or undefined if not found
 */
export function getAgentMetadata(target: object): AgentMetadata | undefined {
  return Reflect.getMetadata(Agent.KEY, target) as AgentMetadata | undefined;
}

/**
 * Helper function to check if a class is decorated with @Agent
 *
 * @param target - The class to check
 * @returns true if the class has agent metadata
 */
export function isAgent(target: object): boolean {
  return Reflect.hasMetadata(Agent.KEY, target);
}
