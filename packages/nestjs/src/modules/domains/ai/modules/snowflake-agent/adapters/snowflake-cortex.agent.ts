import "@langchain/langgraph/zod";

import { randomUUID } from "node:crypto";

import {
  AIMessage,
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
  isAIMessage,
} from "@langchain/core/messages";
import {
  Annotation,
  CompiledStateGraph,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { HttpService } from "@nestjs/axios";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { isAxiosError } from "@nestjs/terminus/dist/utils";
import { firstValueFrom, timeout } from "rxjs";
import { ConversationSession } from "src/common/types/conversation-session.type";
import { normalizeMessage } from "src/common/utils/message.utils";
import {
  SNOWFLAKE_HTTP,
  SnowflakeService,
  SQLExecutionResult,
  TenantContext,
} from "src/modules/snowflake-utils";

import { Agent, GraphAgentPort } from "../../agent-services";

/**
 * Interface for Snowflake Cortex API request format
 */
type SnowflakeCortexRequest = {
  /**
   * The prompt or conversation history to be used to generate a completion. An array of objects representing a conversation in chronological order. Each object must contain either the content key or the content_list key. It may also contain a role key.
   */
  messages: Array<{
    role: "user" | "analyst";
    content: { type: "text"; text: string }[];
  }>;
} & (
  | {
      /**
       * Path to the semantic model YAML file. Must be a fully qualified stage URL including the database and schema.
       */
      semantic_model_file: string;
      semantic_model?: never;
      semantic_models?: never;
      semantic_view?: never;
    }
  | {
      semantic_model_file?: never;
      semantic_model?: never;
      semantic_models: {
        /**
         * specifies a YAML file, stored in a stage, that contains a semantic model definition. (You cannot specify the YAML for the semantic model directly in the request with this form.)
         */
        semantic_model_file?: string;
        /**
         *  specifies the fully qualified name of a semantic view. For example:
         * @example
         * {
         *   ...
         *   "semantic_models": [
         *     {"semantic_view": "my_db.my_sch.my_sem_view_1" },
         *     {"semantic_view": "my_db.my_sch.my_sem_view_2" }
         *   ]
         *   ...
         *  }
         */
        semantic_view?: string;
      }[];
      semantic_view?: never;
    }
  | {
      semantic_model_file?: never;
      semantic_model?: never;
      semantic_models?: never;
      /**
       * Fully qualified name of the semantic view. For example:
       * @example "MY_DB.MY_SCHEMA.SEMANTIC_VIEW"
       */
      semantic_view: string;
    }
);

/**
 * Interface for Snowflake Cortex API response format
 */
interface SnowflakeCortexResponse {
  message: {
    role: "user" | "analyst";
    content: Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "sql";
          statement: string;
          confidence?: {
            verified_query_used: null | {
              name: string;
              question: string;
              sql: string;
              verified_at: number;
              verified_by: string;
            };
          };
        }
      | {
          type: "suggestion";
          suggestions: string[];
        }
    >;
  };
  warnings?: Array<{
    message: string;
  }>;
  response_metadata?: {
    model_names?: string[];
    cortex_search_retrieval?: Record<string, unknown>;
    question_category?: string;
  };
}

@Agent({
  agentId: "snowflake-cortex",
  capabilities: [
    "data-analysis",
    "sql-generation",
    "snowflake-queries",
    "analytics",
  ],
})
@Injectable()
export class SnowflakeCortexAgentAdapter extends GraphAgentPort {
  private readonly logger = new Logger(SnowflakeCortexAgentAdapter.name);
  private readonly requestTimeout = 30000; // 30 seconds

  readonly agentId = "snowflake-cortex";
  readonly agentName = "Snowflake Analyst";

  protected graph:
    | CompiledStateGraph<
        typeof this.stateDefinition.State,
        typeof this.stateDefinition.Update,
        // Node Names
        | "__start__"
        | "cortexAnalystNode"
        | "addTenantSegmentationNode"
        | "executeSnowflakeSQLNode"
      >
    | undefined;

  private stateDefinition = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
        if (Array.isArray(right)) {
          return left.concat(right);
        }
        return left.concat([right]);
      },
      default: () => [],
    }),
    sql: Annotation<
      Extract<
        SnowflakeCortexResponse["message"]["content"][number],
        { type: "sql" }
      >
    >,
    sqlResults: Annotation<SQLExecutionResult>,
    tenantContext: Annotation<{
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      segmentationApplied: boolean;
      allowedTables?: string[];
    }>,
    session: Annotation<ConversationSession>,
  });

  constructor(
    @Inject(SNOWFLAKE_HTTP) private readonly httpService: HttpService,

    private readonly sqlService: SnowflakeService,
  ) {
    super();
  }

  getGraph() {
    if (this.graph) {
      return this.graph;
    }

    const graphBuilder = new StateGraph(this.stateDefinition)
      // 4. Add Nodes to the Graph
      .addNode("cortexAnalystNode", this.cortexAnalystNode)
      .addNode("addTenantSegmentationNode", this.addTenantSegmentationNode)
      .addNode("executeSnowflakeSQLNode", this.executeSnowflakeSQLNode)

      // 5. Add Edges
      // Define the flow between nodes. START and END are special nodes.
      .addEdge(START, "cortexAnalystNode")
      .addConditionalEdges(
        "cortexAnalystNode",
        this.shouldSegmentSql.bind(this),
        { yes: "addTenantSegmentationNode", no: END },
      )
      .addEdge("addTenantSegmentationNode", "executeSnowflakeSQLNode")
      .addEdge("executeSnowflakeSQLNode", END);

    this.graph = graphBuilder.compile();
    return this.graph;
  }

  /**
   * Determine if the next node should be the 'segment sql' node. The criteria is simple - we need to have an sql statement to segment
   * @param state
   * @returns
   */
  private shouldSegmentSql(
    state: typeof this.stateDefinition.State,
  ): "yes" | "no" {
    if (state.sql) {
      return "yes";
    }
    return "no";
  }

  private cortexAnalystNode: typeof this.stateDefinition.Node = async (
    state,
  ) => {
    const startTime = Date.now();

    try {
      // filter messages in state to only those produced by a human, or produced by the cortex analyst service.
      const filteredMessages = this.filterMessagesByCortexAnalystAndHuman(
        state.messages,
      );
      // Convert LangChain messages to Snowflake Cortex format
      const cortexMessages = this.convertMessages(filteredMessages);
      this.logger.debug(cortexMessages);
      // Build request payload
      const requestPayload: SnowflakeCortexRequest = {
        //model: "claude-3-7-sonnet", //todo make this configurable... somehow. potentially by caller
        messages: cortexMessages,
        semantic_models: [
          { semantic_view: "FLICKET_PROD.DATA.AUDIENCE" },
          { semantic_view: "FLICKET_PROD.DATA.REVENUE" },
        ],
      };

      this.logger.debug(
        "Invoking Snowflake Cortex ",
        // requestPayload,
      );

      // Make HTTP request to Snowflake Cortex
      const response = await firstValueFrom(
        this.httpService
          .post<SnowflakeCortexResponse>(
            `/api/v2/cortex/analyst/message`,
            requestPayload,
          )
          .pipe(timeout(this.requestTimeout)),
      );

      // Convert response back to LangChain format
      const responseMessages = this.convertResponseToMessages(response.data);

      const duration = Date.now() - startTime;

      this.logger.debug(`Snowflake Cortex response received in ${duration}ms`);

      const sql = response.data.message.content.find(
        (item) => item.type === "sql",
      );

      return {
        messages: responseMessages,
        ...(sql ? { sql } : {}),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Snowflake Cortex invocation failed",
        error instanceof Error ? error.stack : undefined,
      );
      if (isAxiosError(error)) {
        this.logger.error("axios response");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        this.logger.debug(error.response.data);
      }

      // Return an error message as part of the state
      const errorMessage = new AIMessage(
        `Sorry, I encountered an error while processing your request: ${
          error instanceof Error ? error.message : "Unknown error occurred"
        }`,
      );

      return {
        messages: [errorMessage],
      };
    }
  };

  private addTenantSegmentationNode: typeof this.stateDefinition.Node = (
    state,
  ): typeof this.stateDefinition.Update => {
    this.logger.debug("Starting tenant segmentation");

    if (!state.sql) {
      this.logger.warn("No SQL statement found for segmentation");
      return state;
    }

    try {
      // Extract tenant context from session

      const tenantContext: TenantContext = {
        tenantId: "", //TODO: get from state
      };

      this.logger.debug("Tenant context extracted", {
        tenantId: tenantContext.tenantId,
      });

      const segmentedSqlStatement =
        this.sqlService.applySegmentationToStatement(
          state.sql.statement,
          tenantContext,
        );

      return {
        sql: {
          ...state.sql,
          statement: segmentedSqlStatement,
        },
        tenantContext: {
          ...tenantContext,
          segmentationApplied: true,
        },
      };
    } catch (error) {
      this.logger.error("Tenant segmentation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        sqlPresent: !!state.sql,
      });

      // Continue without segmentation but log the issue
      return {
        ...state,
        tenantContext: {
          segmentationApplied: false,
        },
      };
    }
  };

  private executeSnowflakeSQLNode: typeof this.stateDefinition.Node = async (
    state,
  ) => {
    this.logger.debug("Starting SQL execution");

    if (!state.sql) {
      this.logger.warn("No SQL statement found for execution");
      return state;
    }

    try {
      this.logger.debug("Executing SQL with tenant context");

      // Execute SQL with tenant isolation using config values
      const sqlResults = await this.sqlService.executeSQL(state.sql.statement);

      this.logger.log("SQL execution completed", {
        success: sqlResults.success,
        rowCount: sqlResults.rowCount,
        executionTime: sqlResults.executionTime,
      });

      // Update messages with SQL results
      const resultsMessage = this.formatSQLResultsAsAiMessage(sqlResults);

      const newMessages = [...state.messages];
      if (resultsMessage) {
        newMessages.push(resultsMessage);
      }

      return {
        ...state,
        sqlResults,
        messages: newMessages,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error("SQL execution failed", {
        error: errorMessage,
        tenantId: state.tenantContext?.tenantId,
        sqlPresent: !!state.sql,
      });

      // Create error result
      const errorResult: SQLExecutionResult = {
        data: [],
        metadata: { numRows: 0, format: "json", rowType: [] },
        executionTime: 0,
        rowCount: 0,
        success: false,
        error: errorMessage,
      };

      // Add error message to conversation
      const errorAIMessage = new AIMessage(
        `⚠️ **SQL Execution Error:** ${errorMessage}\n\nI apologize, but I couldn't execute the SQL query. Please try rephrasing your question or contact support if the issue persists.`,
      );

      return {
        ...state,
        sqlResults: errorResult,
        messages: [...state.messages, errorAIMessage],
      };
    }
  };

  /**
   * Enhance messages with SQL execution results
   */
  private formatSQLResultsAsAiMessage(
    sqlResults: SQLExecutionResult,
  ): AIMessage | undefined {
    if (!sqlResults.success || !sqlResults.formattedResults) {
      return;
    }

    // Create enhanced content with SQL results
    const textContent: string[] = [];
    textContent.push(`**Query Results:**
${sqlResults.formattedResults.tableFormat}
`);

    textContent.push(`*${sqlResults.formattedResults.summaryText}*`);

    if (
      sqlResults.formattedResults.insights &&
      sqlResults.formattedResults.insights.length > 0
    ) {
      const insights = sqlResults.formattedResults.insights
        .map((insight) => `• ${insight}`)
        .join("\n");
      textContent.push(`**Key Insights:**\n${insights}`);
    }

    // Create new enhanced message
    const aiMessage = new AIMessage({
      content: textContent.map((item) => ({ type: "text", text: item })),
      response_metadata: {
        sql_execution: {
          success: sqlResults.success,
          rowCount: sqlResults.rowCount,
          executionTime: sqlResults.executionTime,
        },
      },
      additional_kwargs: {
        source_agent: this.agentId,
        source_channel: "internal-enhancement" satisfies SourceChannel,
        sql_results: sqlResults,
      },
    });

    return aiMessage;
  }

  /**
   * Safely convert message content to string
   */
  private formatMessageContentForSnowflakeAnalyst(
    content: unknown,
  ): SnowflakeCortexRequest["messages"][number]["content"] {
    if (typeof content === "string") {
      return [
        {
          type: "text",
          text: content,
        },
      ];
    }
    if (
      Array.isArray(content) &&
      content.length > 0 &&
      content.some(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (c) => typeof c == "object" && "type" in c && c.type === "text",
      )
    ) {
      // it looks like its already in the snowflake structure needed - probably was produced by snowflake in the first place
      return content as SnowflakeCortexRequest["messages"][number]["content"];
    }
    // else make it safe and return it
    return [
      {
        type: "text",
        text: JSON.stringify(content),
      },
    ];
  }

  /**
   * Convert LangChain messages to Snowflake Cortex format
   */
  private convertMessages(
    messages: BaseMessageLike[],
  ): SnowflakeCortexRequest["messages"] {
    const normalisedMessages = messages.map(normalizeMessage);

    return (
      normalisedMessages
        .map((message, idx) => {
          let role: SnowflakeCortexRequest["messages"][number]["role"];

          // this.logger.debug("type", normalizedMessage.getType());

          const messageRole = this.convertMessageTypeToCortex(
            message.getType(),
          );

          if ("user" == messageRole) {
            role = messageRole;
          } else if (
            messageRole === "assistant" &&
            message.additional_kwargs.source_role
          ) {
            role = message.additional_kwargs.source_role as "analyst"; // use the stored value - but we know its always going to be 'analyst'
          } else {
            this.logger.error("Received an unexpected message role");
            this.logger.debug(message);
            return;
          }

          const content = this.formatMessageContentForSnowflakeAnalyst(
            message.content,
          );

          return {
            role,
            content,
          };
        })
        .filter((m) => !!m) // filter undefined's
        // Cortex analyst fails if you send subsequent messages with the same role.
        // the roles must change between messages. This can put is in odd position
        // when the user sends many legitimate messages as a follow up to a cortex
        // analyst produced message. This reduce, attempts to resolve that.
        .reduce<SnowflakeCortexRequest["messages"]>((acc, message, idx) => {
          if (
            //not the first iteration (i.e. there wont be a previous message yet)
            idx > 0 &&
            // previous iteration was 'human' (which is resolved to 'user' for cortex analyst calls)
            acc[acc.length - 1].role === "user" &&
            // current iteration is 'human'
            message.role === "user"
          ) {
            acc[acc.length - 1].content.push(...message.content);
          } else {
            acc.push(message);
          }
          return acc;
        }, [])
    );
  }

  /**
   * Convert Snowflake Cortex response to LangChain messages
   */
  private convertResponseToMessages(
    response: SnowflakeCortexResponse,
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];
    this.logger.debug("response", response);
    const { role, content } = response.message;

    if (role === "user") {
      messages.push(
        new HumanMessage({
          content: content,
        }),
      );
    } else {
      messages.push(
        new AIMessage({
          content,
          response_metadata: response.response_metadata,
          additional_kwargs: {
            source_agent_name: this.agentName,
            source_agent: this.agentId,
            source_channel: "snowflake-cortex" satisfies SourceChannel,
            source_role: response.message.role,
          },
        }),
      );
    }

    return messages;
  }

  private convertMessageTypeToCortex(
    messageType: ReturnType<BaseMessage["getType"]>,
  ) {
    switch (messageType) {
      case "human":
        return "user";
      case "ai":
        return "assistant";
      case "system":
        return messageType;
      default:
        return "unsupported";
    }
  }

  private filterMessagesByCortexAnalystAndHuman(
    messages: BaseMessageLike[],
  ): BaseMessageLike[] {
    return messages.filter((message) => {
      const normalizedMessage = normalizeMessage(message);

      // return all human messages
      if (normalizedMessage.getType() === "human") {
        return true;
      }

      //return Ai Messages produced by upstream cortex analyst
      if (
        isAIMessage(normalizedMessage) &&
        normalizedMessage.additional_kwargs &&
        typeof normalizedMessage.additional_kwargs == "object" &&
        "source_agent" in normalizedMessage.additional_kwargs &&
        "source_channel" in normalizedMessage.additional_kwargs &&
        "source_role" in normalizedMessage.additional_kwargs &&
        normalizedMessage.additional_kwargs.source_agent === this.agentId &&
        (normalizedMessage.additional_kwargs
          .source_channel as SourceChannel) === "snowflake-cortex"
      )
        return true;
    });
  }

  public async healthcheck() {
    const state = (await this.getGraph().invoke(
      {
        messages: [
          new HumanMessage(
            "Retreive all the organisations tha include 'flicket' in there name ",
          ),
        ],
      },
      {
        configurable: {
          thread_id: `health-${randomUUID()}`,
        },
      },
    )) as {
      messages: BaseMessage[];
      sqlResults?: { data: [string, string, string, string][] };
    };
    this.logger.debug(state);

    const aiMessage = state.messages[state.messages.length - 1] as AIMessage;
    const content = aiMessage.content as unknown as string;

    let status: { status: "down" | "up" } = { status: "down" };

    if (state.sqlResults && state.sqlResults.data) {
      if (
        // check the list of results contains the org name and ord ID of our flicket org (these values should never change)
        state.sqlResults.data.some(
          (record) =>
            record[0] === "3da5f0cc-8004-4674-bf2b-e0743cd3f89c" &&
            record[1] === "Flicket Ltd",
        )
      ) {
        status = { status: "up" };
      }
    }
    this.logger.log(status);

    return status;
  }
}

type SourceChannel = "internal-enhancement" | "snowflake-cortex";
