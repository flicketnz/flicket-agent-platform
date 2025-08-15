import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/**
 * DTO for individual chat message in REST API format
 */
export class ChatMessageDto {
  @IsEnum(["user", "assistant", "system"])
  @IsNotEmpty()
  role!: "user" | "assistant" | "system";

  @IsString()
  @IsNotEmpty()
  content!: string;
}

/**
 * DTO for cortex chat request
 */
export class CortexChatRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, any>;

  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

/**
 * DTO for agent metadata in response
 */
export class AgentMetadataDto {
  @IsOptional()
  duration?: number;

  @IsOptional()
  confidence?: number;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  tokensUsed?: number;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  finishReason?: string;
}

/**
 * DTO for cortex chat response
 */
export class CortexChatResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsBoolean()
  success!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentMetadataDto)
  metadata?: AgentMetadataDto;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  nextSuggestedAgent?: string;
}

/**
 * DTO for agent health metrics
 */
export class AgentHealthMetricsDto {
  @IsOptional()
  lastSuccess?: Date;

  @IsOptional()
  successCount?: number;

  @IsOptional()
  errorCount?: number;

  @IsOptional()
  averageResponseTime?: number;

  @IsOptional()
  @IsString()
  endpointVersion?: string;

  @IsOptional()
  @IsString()
  model?: string;
}

/**
 * DTO for cortex health response
 */
export class CortexHealthResponseDto {
  @IsBoolean()
  healthy!: boolean;

  @IsString()
  status!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentHealthMetricsDto)
  metrics?: AgentHealthMetricsDto;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
