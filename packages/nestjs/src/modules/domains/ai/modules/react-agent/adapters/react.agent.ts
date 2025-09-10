import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation } from "@langchain/langgraph";
import {
  createReactAgent,
  createReactAgentAnnotation,
} from "@langchain/langgraph/prebuilt";
import { Injectable, Logger } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { Prompt } from "node_modules/@langchain/langgraph/dist/prebuilt/react_agent_executor";

import { Agent } from "../../agent-services/decorators/agent.decorator";
import { GraphAgentPort } from "../../agent-services/ports/graph-agent.port";
import {
  InjectPrimaryChatModel,
  type PrimaryChatModelPort,
} from "../../model-providers/ports/primary-model.port";
import { AiToolProvider, Tool } from "../../tools/ai-tools";

@Agent({
  agentId: "react-agent",
  capabilities: ["general-reasoning", "tool-usage", "conversation"],
  isPrimary: true,
})
@Injectable()
export class ReactAgentAdapter extends GraphAgentPort {
  private readonly logger = new Logger(ReactAgentAdapter.name);
  private defaultTools: StructuredToolInterface[] | undefined;
  private prompts: {
    systemPrompt: string;
  };

  readonly agentId = "react-agent";
  protected graph: ReturnType<typeof createReactAgent> | undefined;

  public readonly stateDefinition = Annotation.Root({
    ...createReactAgentAnnotation().spec,
  });

  constructor(
    @InjectPrimaryChatModel() private primaryChatModel: PrimaryChatModelPort,
    private discoveryService: DiscoveryService,
  ) {
    super();
    this.prompts = {
      systemPrompt: readFileSync(
        resolve("dist", "prompts", "system.prompt.txt"),
        "utf8",
      ),
    };
  }

  private getTools() {
    if (this.defaultTools) {
      return this.defaultTools;
    }
    // Discover and register tools

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
    this.defaultTools = tools;

    return this.defaultTools;
  }

  private getPrompt(): Prompt {
    const builtPrompt = ChatPromptTemplate.fromTemplate(
      this.prompts.systemPrompt,
    );

    // override the state type - as we need to update this agent state to contain the parent state definition as well
    return async (state: Record<string, any>) => {
      this.logger.debug(state);
      this.logger.debug("prompt builder");
      const p = await builtPrompt.formatMessages({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        humanName: state.invoker?.name,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        currentDateIso: state.invoker?.currentDateIso,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        currentTimezone: state.invoker?.timezone,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        systemPrompt: state.systemPrompt,
      });
      this.logger.debug(p);
      return p;
    };
  }

  public getGraph() {
    this.logger.debug("Getting graph for langgraph agent");
    if (this.graph) {
      return this.graph;
    }
    this.logger.debug("need to compile graph first ");

    const tools = this.getTools();

    this.graph = createReactAgent({
      llm: this.primaryChatModel.model,
      tools,
      // TODO: with these uncommented, we cant call tools successfully. i suspect an issue with missing state but can't confirm, yet.
      // prompt: this.getPrompt(),
      // stateSchema: this.stateDefinition,
      // checkpointSaver: this.checkpointerAdapter.instance,
    });

    this.logger.log(
      `Initialized LangGraph React Agent with ${tools.length} tools`,
    );

    return this.graph;
  }

  public async healthcheck() {
    const state = (await this.getGraph().invoke(
      {
        messages: [
          new HumanMessage(
            'This is a health check - response with exactly `{"status": "ok"} and nothing else',
          ),
        ],
      },
      {
        configurable: {
          thread_id: `health-${randomUUID()}`,
        },
      },
    )) as { messages: BaseMessage[] };

    const aiMessage = state.messages[state.messages.length - 1] as AIMessage;
    const content = aiMessage.content as unknown as string;
    const status = JSON.parse(content) as { status: "up" };
    this.logger.log(status);

    return status;
  }
}
