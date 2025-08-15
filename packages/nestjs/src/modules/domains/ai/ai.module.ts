import { Module } from "@nestjs/common";

import { AgentsModule } from "./modules/agents/agents.module";
import { LlmModule } from "./modules/llm/llm.module";
import { LlmStorageModule } from "./modules/llm-storage/llm-storage.module";
import { ModelProviderModule } from "./modules/model-providers/model-provider.module";
import { AiToolsModule } from "./modules/tools/tools.module";

@Module({
  imports: [
    LlmStorageModule,
    AgentsModule,
    AiToolsModule,
    ModelProviderModule,
    LlmModule,
  ],
  exports: [],
})
export class AiModule {}
