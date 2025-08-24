import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ConversationSession } from "src/common/types/conversation-session.type";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "src/modules/auth/types/auth.types";

import { AgentInvocationInput, AgentInvocationResult } from "../../agents";
import { SnowflakeCortexAgentAdapter } from "../adapters/snowflake-cortex.agent";
import type {
  ChatMessageDto,
  CortexChatRequestDto,
  CortexChatResponseDto,
  CortexHealthResponseDto,
} from "./dtos/cortex.dto";

@Controller("agents/cortex")
@UseGuards(JwtAuthGuard)
export class CortexController {
  private readonly logger = new Logger(CortexController.name);

  constructor(
    private readonly snowflakeCortexAgent: SnowflakeCortexAgentAdapter,
  ) {
    if (!this.snowflakeCortexAgent) {
      this.logger.warn(
        "SnowflakeCortexAgentAdapter is not available - agent may be disabled in configuration",
      );
    }
  }

  @Post("chat")
  async chat(
    @Body() request: CortexChatRequestDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CortexChatResponseDto> {
    const startTime = Date.now();
    const userId = req.user?.sub || request.userId;

    this.logger.log(
      `Chat request from user ${userId} for session ${request.sessionId} with ${request.messages.length} messages`,
    );

    try {
      // Check if agent is available
      if (!this.snowflakeCortexAgent) {
        throw new HttpException(
          "Snowflake Cortex agent is not available",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      // Convert REST API messages to LangChain BaseMessage format
      const langchainMessages = this.convertToLangChainMessages(
        request.messages,
      );

      // Create conversation session object
      const session: ConversationSession = {
        sessionId: request.sessionId,
        userId: userId,
        startedAt: new Date(),
        lastActivity: new Date(),
        metadata: {
          source: "cortex-controller",
          userAgent: req.headers["user-agent"],
          ip: req.ip,
        },
      };

      // Create agent invocation input
      const agentInput: Record<string, any> = {
        messages: langchainMessages,
        session,
        context: request.context,
        systemPrompt: request.systemPrompt,
        metadata: {
          requestId: `cortex-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId,
          sessionId: request.sessionId,
        },
      } satisfies AgentInvocationInput;

      this.logger.debug(
        `Invoking Snowflake Cortex agent for session ${request.sessionId}`,
      );

      // Invoke the Snowflake Cortex agent
      const agentResult: AgentInvocationResult =
        (await this.snowflakeCortexAgent
          .getGraph()
          .invoke(agentInput)) as unknown as AgentInvocationResult;

      // Convert response back to REST API format
      const responseMessages = this.convertFromLangChainMessages(
        agentResult.messages,
      );

      const totalDuration = Date.now() - startTime;

      this.logger.log(
        `Chat response for user ${userId} session ${request.sessionId}: ${agentResult.success ? "success" : "failure"} in ${totalDuration}ms`,
      );

      return {
        messages: responseMessages,
        success: agentResult.success,
        metadata: {
          ...agentResult.metadata,
          duration: totalDuration,
        },
        error: agentResult.error,
        nextSuggestedAgent: agentResult.nextSuggestedAgent,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(
        `Chat request failed for user ${userId} session ${request.sessionId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Handle specific error types
      if (error instanceof HttpException) {
        throw error;
      }

      // Return error response instead of throwing for better client experience
      return {
        messages: [],
        success: false,
        metadata: {
          duration: totalDuration,
          agentId: "snowflake-cortex",
        },
        error: errorMessage,
      };
    }
  }

  @Get("health")
  health(@Request() req: AuthenticatedRequest): CortexHealthResponseDto {
    const userId = req.user?.sub;

    this.logger.debug(`Health check requested by user ${userId}`);

    try {
      // Check if agent is available
      if (!this.snowflakeCortexAgent) {
        const response: CortexHealthResponseDto = {
          healthy: false,
          status: "Snowflake Cortex agent is not available or disabled",
          agentId: "snowflake-cortex",
          version: "unknown",
          capabilities: [],
        };

        this.logger.warn(
          `Health check failed: agent not available (requested by ${userId})`,
        );
        return response;
      }

      // Call agent health check
      // const healthResult = await this.snowflakeCortexAgent.healthCheck();

      // Get agent capabilities
      // const capabilities = await this.snowflakeCortexAgent.getCapabilities();

      const response: any = {
        // const response: CortexHealthResponseDto = {
        // healthy: healthResult.healthy,
        // status: healthResult.status,
        // metrics: healthResult.metrics,
        agentId: this.snowflakeCortexAgent.agentId,
        // version: this.snowflakeCortexAgent.version,
        // capabilities: capabilities?.capabilities || [],
      };

      // this.logger.log(
      //   `Health check completed for user ${userId}: ${healthResult.healthy ? "healthy" : "unhealthy"}`,
      // );

      // Set appropriate HTTP status based on health
      // if (!healthResult.healthy) {
      //   throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      // }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(
        `Health check failed for user ${userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Handle HTTP exceptions
      if (error instanceof HttpException) {
        throw error;
      }

      // Return error response
      const response: CortexHealthResponseDto = {
        healthy: false,
        status: `Health check failed: ${errorMessage}`,
        agentId: "snowflake-cortex",
        version: "unknown",
        capabilities: [],
      };

      throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Convert REST API message format to LangChain BaseMessage format
   */
  private convertToLangChainMessages(
    messages: ChatMessageDto[],
  ): BaseMessage[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case "user":
          return new HumanMessage(msg.content);
        case "assistant":
          return new AIMessage(msg.content);
        case "system":
          return new SystemMessage(msg.content);
        default:
          throw new Error(`Unsupported message role: ${String(msg.role)}`);
      }
    });
  }

  /**
   * Convert LangChain BaseMessage format back to REST API message format
   */
  private convertFromLangChainMessages(
    messages: BaseMessage[],
  ): ChatMessageDto[] {
    return messages.map((msg) => {
      let role: "user" | "assistant" | "system";

      const messageType = msg.getType();
      switch (messageType) {
        case "human":
          role = "user";
          break;
        case "ai":
          role = "assistant";
          break;
        case "system":
          role = "system";
          break;
        default:
          this.logger.warn(
            `Unknown message type: ${messageType}, defaulting to assistant`,
          );
          role = "assistant";
      }

      // Handle content - could be string or complex object
      let content: string;
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (typeof msg.content === "object" && msg.content !== null) {
        content = JSON.stringify(msg.content);
      } else {
        content = String(msg.content);
      }

      return {
        role,
        content,
      };
    });
  }
}
