/**
 * Barrel export file for the Orchestration Module
 *
 * This file exports all public-facing components from the orchestration module,
 * including the module itself, services, and types that other modules might need to use.
 */

// Export the main module
export { OrchestrationModule } from "./orchestration.module";

// Export the orchestration service
export { GraphOrchestratorService } from "./services";

// Export orchestration types and interfaces
export type {
  GraphOrchestrationInput,
  GraphOrchestrationResult,
} from "./services/graph-orchestrator.service";
