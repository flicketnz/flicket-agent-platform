import {
  AIMessage,
  BaseMessage,
  BaseMessageLike,
} from "@langchain/core/messages";
import { HttpService } from "@nestjs/axios";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import { firstValueFrom, timeout } from "rxjs";
import agentSnowflakeCortexConfig from "src/modules/config-management/configs/agent-snowflake-cortex.config";

import { normalizeMessage } from "../agent.utils";
import { Agent } from "../decorators/agent.decorator";
import {
  AgentHealthResult,
  AgentInvocationInput,
  AgentInvocationResult,
  AgentPort,
} from "../ports/agent.port";

/**
 * Interface for Snowflake Cortex API request format
 */
interface SnowflakeCortexRequest {
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Interface for Snowflake Cortex API response format
 */
interface SnowflakeCortexResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  id?: string;
  model?: string;
}

/**
 * Interface for Snowflake Cortex health check response
 */
interface SnowflakeCortexHealthResponse {
  status: "healthy" | "unhealthy";
  version?: string;
  model?: string;
}

@Agent({
  agentId: "snowflake-cortex",
  capabilities: [
    "data-analysis",
    "sql-generation",
    "snowflake-queries",
    "analytics",
  ],
  isPrimary: false,
  priority: 80,
  description: "Snowflake Cortex agent for data analysis and SQL generation",
})
@Injectable()
export class SnowflakeCortexAgentAdapter implements AgentPort {
  private readonly logger = new Logger(SnowflakeCortexAgentAdapter.name);
  private readonly requestTimeout = 30000; // 30 seconds

  //TODO: i think the only data required in the decorator is the capabilities - reducing the duplciation required. unsure at this stage though
  readonly agentId = "snowflake-cortex";
  readonly agentName = "Snowflake Cortex Agent";
  readonly description =
    "Snowflake Cortex agent for data analysis and SQL generation";
  readonly version = "1.0.0";

  constructor(
    @Inject(agentSnowflakeCortexConfig.KEY)
    private readonly config: ConfigType<typeof agentSnowflakeCortexConfig>,
    private readonly httpService: HttpService,
  ) {}

  async invoke(input: AgentInvocationInput): Promise<AgentInvocationResult> {
    const startTime = Date.now();

    try {
      // Validate input first
      const validation = await this.validateInput(input);
      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors?.join(", ")}`);
      }

      // Convert LangChain messages to Snowflake Cortex format
      const cortexMessages = this.convertMessages(input.messages);

      // Build request payload
      const requestPayload: SnowflakeCortexRequest = {
        messages: cortexMessages,
        temperature: 0.7,
        max_tokens: 4000,
        stream: false,
      };

      this.logger.debug(
        `Invoking Snowflake Cortex for session ${input.session.sessionId}`,
      );

      // Make HTTP request to Snowflake Cortex
      const response = await firstValueFrom(
        this.httpService
          .post<SnowflakeCortexResponse>(
            `${this.config.endpoint}/chat`,
            requestPayload,
            {
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "flicket-agent-platform/1.0.0",
              },
            },
          )
          .pipe(timeout(this.requestTimeout)),
      );

      // Convert response back to LangChain format
      const responseMessages = this.convertResponseToMessages(response.data);

      const duration = Date.now() - startTime;

      return {
        messages: responseMessages,
        metadata: {
          duration,
          confidence: 0.85, // Default confidence for Snowflake Cortex
          agentId: this.agentId,
          tokensUsed: response.data.usage?.total_tokens,
          model: response.data.model,
          finishReason: response.data.choices[0]?.finish_reason,
        },
        success: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Snowflake Cortex invocation failed",
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
      if (!this.config.endpoint) {
        return {
          healthy: false,
          status: "Snowflake Cortex endpoint not configured",
          metrics: {
            errorCount: 1,
          },
        };
      }

      // Make health check request
      const response = await firstValueFrom(
        this.httpService
          .get<SnowflakeCortexHealthResponse>(
            `${this.config.endpoint}/health`,
            {
              headers: {
                "User-Agent": "flicket-agent-platform/1.0.0",
              },
            },
          )
          .pipe(timeout(10000)), // 10 second timeout for health check
      );

      const isHealthy = response.data.status === "healthy";

      return {
        healthy: isHealthy,
        status: isHealthy
          ? "Snowflake Cortex agent is healthy and ready"
          : `Snowflake Cortex reports status: ${response.data.status}`,
        metrics: {
          lastSuccess: isHealthy ? new Date() : undefined,
          successCount: isHealthy ? 1 : 0,
          errorCount: isHealthy ? 0 : 1,
          endpointVersion: response.data.version,
          model: response.data.model,
        },
      };
    } catch (error) {
      this.logger.error(
        "Snowflake Cortex health check failed",
        error instanceof Error ? error.stack : undefined,
      );

      return {
        healthy: false,
        status: `Health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        metrics: {
          errorCount: 1,
        },
      };
    }
  }

  getCapabilities() {
    return Promise.resolve({
      supportedTaskTypes: [
        "data-analysis",
        "sql-generation",
        "snowflake-queries",
        "analytics",
        "business-intelligence",
        "data-insights",
      ],
      requiredInputs: ["messages", "session"],
      optionalInputs: ["context", "systemPrompt", "metadata"],
      maxMessages: 50, // Reasonable limit for API efficiency
      responseTimeRange: {
        min: 2000, // 2 seconds
        max: 30000, // 30 seconds
      },
      endpointUrl: this.config.endpoint,
      timeout: this.requestTimeout,
      capabilities: [
        "data-analysis",
        "sql-generation",
        "snowflake-queries",
        "analytics",
      ],
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

    // TODO: there is a maxMessages property in the getCapailities method - which we cant easily consume here as that method is async
    // TODO: dont hardcode the max messages
    if (input.messages && input.messages.length > 50) {
      errors.push(
        "Too many messages - Snowflake Cortex supports up to 50 messages per request",
      );
    }

    if (!this.config.endpoint) {
      errors.push("Snowflake Cortex endpoint not configured");
    }

    // Check message content length
    const totalContentLength = input.messages
      .map((msg) => this.getMessageContentLength(normalizeMessage(msg).content))
      .reduce((total, length) => total + length, 0);

    if (totalContentLength > 100000) {
      warnings.push(
        "Large message content may impact performance and API limits",
      );
    }

    return Promise.resolve({
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }

  /**
   * Safely get the length of message content
   */
  private getMessageContentLength(content: unknown): number {
    if (typeof content === "string") {
      return content.length;
    }
    if (typeof content === "object" && content !== null) {
      return JSON.stringify(content).length;
    }
    return String(content).length;
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
        const messageRole = normalizedMessage.getType();
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
          content,
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

    for (const choice of response.choices) {
      if (choice.message.role === "assistant") {
        messages.push(new AIMessage(choice.message.content));
      }
    }

    return messages;
  }
}
