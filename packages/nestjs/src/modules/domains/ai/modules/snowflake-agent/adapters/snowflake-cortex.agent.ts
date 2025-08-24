import "@langchain/langgraph/zod";

import {
  AIMessage,
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
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
import type { ConfigType } from "@nestjs/config";
import { isAxiosError } from "@nestjs/terminus/dist/utils";
import { firstValueFrom, timeout } from "rxjs";
import { ConversationSession } from "src/common/types/conversation-session.type";
import { normalizeMessage } from "src/common/utils/message.utils";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { Agent, GraphAgentPort } from "../../agents";
import { SnowflakeJwtService } from "../services/snowflake-jwt.service";
import {
  SnowflakeSQLService,
  SQLExecutionResult,
  TenantContext,
} from "../services/snowflake-sql.service";

/**
 * Interface for Snowflake Cortex API request format
 */
type SnowflakeCortexRequest = {
  /**
   * The prompt or conversation history to be used to generate a completion. An array of objects representing a conversation in chronological order. Each object must contain either the content key or the content_list key. It may also contain a role key.
   */
  messages: Array<{
    role: "user" | "assistant" | "system";
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
    private readonly httpService: HttpService,
    private jwtService: SnowflakeJwtService,
    private readonly sqlService: SnowflakeSQLService,
    @Inject(agentSnowflakeCortexConfig.KEY)
    private readonly config: ConfigType<typeof agentSnowflakeCortexConfig>,
  ) {
    super();
    // Set auth via an interceptor so the token is updated on every call (if required)
    httpService.axiosRef.interceptors.request.use(
      (config) => {
        const token = this.jwtService.getJwt();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          config.headers["X-Snowflake-Authorization-Token-Type"] =
            "KEYPAIR_JWT";
        }
        return config;
      },
      (error) => {
        if (error instanceof Error) {
          return Promise.reject(error);
        } else {
          return Promise.reject(new Error(error));
        }
      },
    );
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
      // Convert LangChain messages to Snowflake Cortex format
      const cortexMessages = this.convertMessages(state.messages);
      this.logger.debug(cortexMessages);
      // Build request payload
      const requestPayload: SnowflakeCortexRequest = {
        //model: "claude-3-7-sonnet", //todo make this configurable... somehow. potentially by caller
        messages: cortexMessages,
        semantic_model_file:
          "@POSTGRES_SOURCE.NZ.SEMANTIC_MODEL_REVENUE_MODEL_STAGE/revenue.yaml", // TODO make configureable from config,
      };

      this.logger.debug("Invoking Snowflake Cortex");

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
        sql_results: sqlResults,
      },
    });

    return aiMessage;
  }

  /**
   * Safely convert message content to string
   */
  private messageContentToString(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    if (typeof content === "object" && content !== null) {
      return JSON.stringify(content);
    }
    return String(content);
  }

  /**
   * Convert LangChain messages to Snowflake Cortex format
   */
  private convertMessages(
    messages: BaseMessageLike[],
  ): SnowflakeCortexRequest["messages"] {
    return messages
      .map((message) => {
        let role: "user" | "assistant" | "system";

        const normalizedMessage = normalizeMessage(message);

        this.logger.debug("normalised message", normalizedMessage);
        this.logger.debug("type", normalizedMessage.getType());

        const messageRole = this.convertMessageTypeToCortex(
          normalizedMessage.getType(),
        );

        if (["user", "assistant", "system"].includes(messageRole)) {
          role = messageRole as "user" | "assistant" | "system";
        } else {
          this.logger.error("Received an unexpected message role");
          this.logger.debug(message);
          return;
        }

        const content = this.messageContentToString(normalizedMessage.content);

        return {
          role,
          content: [{ type: "text" as const, text: content }],
        };
      })
      .filter((m) => !!m); // filter undefined's
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
            source_agent: this.agentId,
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
}
