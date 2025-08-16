import { Module } from "@nestjs/common";

import { LlmModule } from "./modules/llm/llm.module";
import { LlmStorageModule } from "./modules/llm-storage/llm-storage.module";
import { OrchestrationModule } from "./modules/orchestration";
import { AiToolsModule } from "./modules/tools/tools.module";

@Module({
  imports: [LlmStorageModule, AiToolsModule, LlmModule, OrchestrationModule],
  exports: [],
})
export class AiModule {}
