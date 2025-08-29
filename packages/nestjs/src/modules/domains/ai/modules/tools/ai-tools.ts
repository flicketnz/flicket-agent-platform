import { BaseToolkit, StructuredTool } from "@langchain/core/tools";
import { DiscoveryService } from "@nestjs/core";

export type AiToolProvider = {
  tool: StructuredTool | BaseToolkit | undefined;
};

export const Tool = DiscoveryService.createDecorator();
