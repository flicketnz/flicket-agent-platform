import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ChatMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  StructuredToolInterface,
  type Tool as BaseTool,
} from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryService } from "@nestjs/core";
import { ConversationSession } from "src/common/types/conversation-session.type";

import {
  type CheckpointerPort,
  InjectCheckpointer,
} from "../../llm-storage/ports/checkpointer.port";
import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers/ports/primary-model.port";
import { AiToolProvider, Tool } from "../../tools/ai-tools";

@Injectable()
export class LlmService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LlmService.name);
  private defaultTools: StructuredToolInterface[] = [];
  private prompts: {
    systemPrompt: string;
  };

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

  onApplicationBootstrap() {
    // TODO: refine this to only get tools providers that are in scope of this module. currently gets providers from across the system
    const toolsAndToolkits = this.discoveryService
      .getProviders({ metadataKey: Tool.KEY })
      // ge the tools formt he providers
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
  }

  async generateResponse(
    question: string,
    options: {
      session: ConversationSession;
      additionalSystemPrompt?: string;
      progressCallback?: (message: string) => void | Promise<void>;
    },
  ) {
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", this.prompts.systemPrompt],
    ]);
    this.logger.debug("sessionId", options.session.sessionId);

    const agent = createReactAgent({
      llm: this.primaryChatModel.model,
      tools: this.defaultTools,
      prompt: await prompt.format({
        human_name: `<@${options.session.userId}> (using exactly this syntax will translate to the humans name as a mention in slack)`,
        system_prompt: options.additionalSystemPrompt,
        current_date_iso: new Date().toISOString(),
        current_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      checkpointSaver: this.checkpointerAdapter.instance,
    });

    const langGraphConfig: Parameters<typeof agent.invoke>[1] = {
      configurable: {
        thread_id: options.session.sessionId,
      },
    };

    const agentResult = await agent.invoke(
      {
        messages: [new HumanMessage(question)],
      },
      langGraphConfig,
    );

    this.logger.debug("The agent output", { agentResult });

    // Otherwise return the raw text
    return agentResult;
  }

  /**
   * Gets available tools
   */
  getAvailableTools(): StructuredToolInterface[] {
    return [...this.defaultTools];
  }

  /**
   * Adds a custom tool
   */
  addTool(tool: BaseTool): void {
    this.defaultTools.push(tool);
  }

  /**
   * Health check for the LLM service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test to verify LLM is responsive
      const testResult = await this.primaryChatModel.model.invoke([
        new ChatMessage({ content: "Hello", role: "human" }),
      ]);
      return !!testResult.content;
    } catch (error) {
      this.logger.error(
        "LLM health check failed",
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
