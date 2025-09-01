/**
 * Barrel export file for the Agents Module
 *
 * This file exports all public-facing components from the agents module,
 * including the module itself, services, ports, decorators, and interfaces
 * that other modules might need to use.
 */

// Export the main module
export { ReactAgentModule } from "./react-agent.module";

// Agent Adaters
export * from "./adapters/index";
