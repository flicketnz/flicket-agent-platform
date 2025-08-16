/**
 * Barrel export file for the Agents Module
 *
 * This file exports all public-facing components from the agents module,
 * including the module itself, services, ports, decorators, and interfaces
 * that other modules might need to use.
 */

// Export the main module
export { AgentsModule } from "./agents.module";

// Export key services for external use
export { AgentRegistryService } from "./services";

// Export agent adapters for external use
export * from "./adapters";

// Export ports and interfaces
export * from "./ports";

// Export decorators for agent registration
export * from "./decorators";

// Export controllers and DTOs for external access
export { CortexController } from "./controllers";
export * from "./controllers/dtos/cortex.dto";
