import { HumanMessage } from "@langchain/core/messages";
import {
  Annotation,
  CompiledStateGraph,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { SQLExecutionResult } from "src/modules/snowflake-utils";

import { Agent, GraphAgentPort } from "../../agent-services";
import type { PrimaryChatModelPort } from "../../model-providers";
import { SnowflakeCortexAgentAdapter } from "../../snowflake-agent/adapters/snowflake-cortex.agent";

/**
 * Defines the state for the Marketing Campaign Agent.
 */
const agentState = {
  ...MessagesAnnotation.spec,
  eventId: Annotation<string>,
  rawUserList: Annotation<SQLExecutionResult["data"]>,
  // TODO: Define additional state properties as needed
};

/**
 * Agent Identifier
 */
const agentId = "marketing-campaign";
/**
 * Agent Name
 */
const agentName = "Marketing Campaign Agent";

@Injectable()
@Agent({
  agentId,
  capabilities: ["marketing", "user-segmentation"],
})
export class MarketingCampaignAgent extends GraphAgentPort {
  readonly agentId = agentId;
  readonly agentName = agentName;
  protected graph: CompiledStateGraph<any, any, any> | undefined;
  private readonly logger = new Logger(
    `${MarketingCampaignAgent.name} - ${agentId}`,
  );

  private readonly stateDefinition = Annotation.Root(agentState);

  constructor(
    private readonly primaryChatModel: PrimaryChatModelPort,
    private readonly cortexAgent: SnowflakeCortexAgentAdapter,
  ) {
    super();
  }

  /**
   * @inheritdoc
   */
  getGraph() {
    if (this.graph) {
      return this.graph;
    }
    const graphBuilder = new StateGraph(this.stateDefinition);

    // TODO: Implement the graph nodes and edges
    this.graph = graphBuilder
      .addNode("queryPotentialUsers", this.queryPotentialUsers)
      .addEdge(START, "queryPotentialUsers")
      .addEdge("queryPotentialUsers", END)
      .compile();

    return this.graph;
  }

  /**
   * Placeholder for the starting node of the graph.
   */
  private queryPotentialUsers: typeof this.stateDefinition.Node = async (
    state,
  ) => {
    this.logger.debug(`Querying potential users for event: ${state.eventId}`);

    const subGraph = this.cortexAgent.getGraph();
    const response = (await subGraph.invoke(
      {
        messages: [
          new HumanMessage(
            `Find a list of users who would be interested in attending the event with ID ${state.eventId}.`,
          ),
        ],
      },
      {
        configurable: {
          thread_id: randomUUID(),
        },
      },
    )) as { sqlResults: SQLExecutionResult };

    this.logger.debug(
      `Received ${response.sqlResults.rowCount} potential users from Cortex.`,
    );

    return { rawUserList: response.sqlResults.data };
  };

  healthcheck() {
    return { status: "up" as const };
  }
}
