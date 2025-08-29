import { SearxngSearch } from "@langchain/community/tools/searxng_search";
import type { Tool as BaseTool } from "@langchain/core/tools";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { type AiToolProvider, Tool } from "./ai-tools";

@Injectable()
@Tool()
export class SearxngTool implements AiToolProvider, OnModuleInit {
  public tool!: BaseTool | undefined;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const enabled = this.configService.get<string>("llm.tools.searxng.enabled");
    if (enabled) {
      this.tool = new SearxngSearch({
        apiBase: this.configService.get<string>("llm.tools.searxng.apiBase"),
        params: {
          format: "json",
          engines: "duckduckgo,yahoo,google,brave,bing",
        },
        headers: {},
      });
    }
  }
}
