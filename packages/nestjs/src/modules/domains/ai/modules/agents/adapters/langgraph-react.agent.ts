import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ChatMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredToolInterface } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryService } from "@nestjs/core";

import {
  type CheckpointerPort,
  InjectCheckpointer,
} from "../../llm-storage/ports/checkpointer.port";
import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers/ports/primary-model.port";
import { AiToolProvider, Tool } from "../../tools/ai-tools";
import { Agent } from "../decorators/agent.decorator";
import {
  AgentHealthResult,
  AgentInvocationInput,
  AgentInvocationResult,
  AgentPort,
} from "../ports/agent.port";

@Agent({
  agentId: "langgraph-react",
  capabilities: ["general-reasoning", "tool-usage", "conversation"],
  isPrimary: true,
  priority: 100,
  description: "Primary LangGraph React agent with tool capabilities",
})
@Injectable()
export class LangGraphReactAgentAdapter implements AgentPort, OnModuleInit {
  private readonly logger = new Logger(LangGraphReactAgentAdapter.name);
  private defaultTools: StructuredToolInterface[] = [];
  private prompts: {
    systemPrompt: string;
  };

  readonly agentId = "langgraph-react";
  readonly agentName = "LangGraph React Agent";
  readonly description = "Primary LangGraph React agent with tool capabilities";
  readonly version = "1.0.0";

  constructor(
    private readonly configService: ConfigService,
    @InjectPrimaryChatModel() private primaryChatModel: PrimaryChatModelPort,
    private discoveryService: DiscoveryService,
    @InjectCheckpointer() private checkpointerAdapter: CheckpointerPort,
  ) {
    this.prompts = {
      systemPrompt: readFileSync(
        resolve("dist", "prompts", "system.prompt.txt"),
        "utf8",
      ),
    };
  }

  onModuleInit() {
    // Discover and register tools (moved from LlmService.onApplicationBootstrap)
    // TODO: refine this to only get tools providers that are in scope of this module. currently gets providers from across the system
    const toolsAndToolkits = this.discoveryService
      .getProviders({ metadataKey: Tool.KEY })
      // get the tools from the providers
      .map((tp) => (tp.instance as AiToolProvider).tool)
      // filter out the undefined (disabled) tools
      .filter((tool) => !!tool);

    const tools = toolsAndToolkits.reduce<StructuredToolInterface[]>(
      (toolList, t) => {
        if ("tools" in t) {
          toolList.push(...t.getTools());
        } else {
          toolList.push(t);
        }
        return toolList;
      },
      [],
    );
    // add tools
    this.defaultTools.push(...tools);

    this.logger.log(
      `Initialized LangGraph React Agent with ${this.defaultTools.length} tools`,
    );
  }

  async invoke(input: AgentInvocationInput): Promise<AgentInvocationResult> {
    const startTime = Date.now();

    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", this.prompts.systemPrompt],
      ]);

      this.logger.debug("sessionId", input.session.sessionId);

      // Build the system prompt with provided context
      const systemPromptContent = await prompt.format({
        human_name: `<@${input.session.userId}> (using exactly this syntax will translate to the humans name as a mention in slack)`,
        system_prompt: (input.systemPrompt ||
          input.context?.additionalSystemPrompt ||
          "") as string,

        // TODO: the date and timezone should come from the caller, not the server
        current_date_iso: new Date().toISOString(),
        current_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      const agent = createReactAgent({
        llm: this.primaryChatModel.model,
        tools: this.defaultTools,
        prompt: systemPromptContent,
        checkpointSaver: this.checkpointerAdapter.instance,
      });

      const langGraphConfig: Parameters<typeof agent.invoke>[1] = {
        configurable: {
          thread_id: input.session.sessionId,
        },
      };

      const agentResult = await agent.invoke(
        {
          messages: input.messages,
        },
        langGraphConfig,
      );

      const duration = Date.now() - startTime;

      return {
        messages: agentResult.messages || [],
        metadata: {
          duration,
          // TODO: remove confidence if we cant set a suitable value
          confidence: 1.0, // LangGraph doesn't provide confidence, default to high
          agentId: this.agentId,
          // TODO: remove toolsUsed - this isnt providing value as it is
          toolsUsed: this.defaultTools.length,
        },
        success: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Agent invocation failed",
        error instanceof Error ? error.stack : undefined,
      );

      return {
        messages: [],
        metadata: {
          duration,
          agentId: this.agentId,
        },
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async healthCheck(): Promise<AgentHealthResult> {
    try {
      // Simple test to verify LLM is responsive
      const testResult = await this.primaryChatModel.model.invoke([
        new ChatMessage({ content: "Hello", role: "human" }),
      ]);

      const isHealthy = !!testResult.content;

      return {
        healthy: isHealthy,
        status: isHealthy
          ? `Agent is healthy with ${this.defaultTools.length} tools available`
          : "Agent is not responding properly",
        metrics: {
          //TODO: most of these metrics do not add value. they are derivde from basic stuff - we should probably remove them
          lastSuccess: isHealthy ? new Date() : undefined,
          successCount: isHealthy ? 1 : 0,
          errorCount: isHealthy ? 0 : 1,
          toolsCount: this.defaultTools.length,
          modelType: this.primaryChatModel.model.constructor.name,
        },
      };
    } catch (error) {
      this.logger.error(
        "Agent health check failed",
        error instanceof Error ? error.stack : undefined,
      );

      return {
        healthy: false,
        status: `Health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        metrics: {
          errorCount: 1,
          toolsCount: this.defaultTools.length,
        },
      };
    }
  }

  getCapabilities() {
    //TODO: review how 'capabilities' are being used. there seems to be duplicate and worthless stuff in this object
    return Promise.resolve({
      supportedTaskTypes: [
        "general-reasoning",
        "tool-usage",
        "conversation",
        "question-answering",
        "task-execution",
      ],
      requiredInputs: ["messages", "session"],
      optionalInputs: ["context", "systemPrompt", "metadata"],
      maxMessages: 1000, // Reasonable default
      responseTimeRange: {
        min: 1000, // 1 second
        max: 30000, // 30 seconds
      },
      toolsAvailable: this.defaultTools.length,
      modelProvider: this.primaryChatModel.model.constructor.name,
    });
  }

  validateInput(input: AgentInvocationInput) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.messages || input.messages.length === 0) {
      errors.push("Messages array is required and cannot be empty");
    }

    if (!input.session) {
      errors.push("Session is required");
    } else {
      if (!input.session.sessionId) {
        errors.push("Session must have a valid sessionId");
      }
      if (!input.session.userId) {
        warnings.push(
          "Session userId is not provided - some features may be limited",
        );
      }
    }

    if (input.messages && input.messages.length > 1000) {
      warnings.push("Large number of messages may impact performance");
    }

    return Promise.resolve({
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }
}
