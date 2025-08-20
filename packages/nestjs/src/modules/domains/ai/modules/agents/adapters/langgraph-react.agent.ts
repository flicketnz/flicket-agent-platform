import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation } from "@langchain/langgraph";
import {
  createReactAgent,
  createReactAgentAnnotation,
} from "@langchain/langgraph/prebuilt";
import { Injectable, Logger } from "@nestjs/common";
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
import { GraphAgentPort } from "../ports/graph-agent.port";

@Agent({
  agentId: "langgraph-react",
  capabilities: ["general-reasoning", "tool-usage", "conversation"],
  isPrimary: true,
})
@Injectable()
export class LangGraphReactAgentAdapter extends GraphAgentPort {
  private readonly logger = new Logger(LangGraphReactAgentAdapter.name);
  private defaultTools: StructuredToolInterface[] | undefined;
  private prompts: {
    systemPrompt: string;
  };

  readonly agentId = "langgraph-react";
  protected graph: ReturnType<typeof createReactAgent> | undefined;

  public readonly stateDefinition = Annotation.Root({
    // ...MessagesAnnotation.spec,
    ...createReactAgentAnnotation().spec,
    humanName: Annotation<string>(),
    currentDateIso: Annotation<string>(),
    currentTimezone: Annotation<string>(),
    systemPrompt: Annotation<string>(),
  });

  constructor(
    @InjectPrimaryChatModel() private primaryChatModel: PrimaryChatModelPort,
    private discoveryService: DiscoveryService,
    @InjectCheckpointer() private checkpointerAdapter: CheckpointerPort,
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
    this.defaultTools = tools;

    return this.defaultTools;
  }

  private getPrompt() {
    const builtPrompt = ChatPromptTemplate.fromTemplate(
      this.prompts.systemPrompt,
    );

    return builtPrompt;
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
      checkpointSaver: this.checkpointerAdapter.instance,
    });

    this.logger.log(
      `Initialized LangGraph React Agent with ${tools.length} tools`,
    );

    return this.graph;
  }
}
