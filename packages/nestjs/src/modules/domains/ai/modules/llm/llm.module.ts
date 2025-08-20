import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DiscoveryModule } from "@nestjs/core";
import { CqrsModule } from "@nestjs/cqrs";

import { LlmStorageModule } from "../llm-storage/llm-storage.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { LlmConversationQueryHandler } from "./handlers/query/llm-conversation.query-handler";
import { LlmService } from "./services/llm.service";

const queryHandlers = [LlmConversationQueryHandler];

@Module({
  imports: [
    CqrsModule,
    ConfigModule,
    DiscoveryModule,
    LlmStorageModule,
    OrchestrationModule,
  ],
  providers: [...queryHandlers, LlmService],
  exports: [],
})
export class LlmModule {}
