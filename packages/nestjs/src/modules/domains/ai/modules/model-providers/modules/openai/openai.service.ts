import { ChatOpenAI } from "@langchain/openai";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { PrimaryChatModelPort } from "../../ports/primary-model.port";

@Injectable()
export class OpenAIModelProviderService
  implements PrimaryChatModelPort, OnModuleInit
{
  private readonly logger = new Logger(OpenAIModelProviderService.name);
  public model!: ChatOpenAI;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.logger.debug("registering the openai model");
    this.model = new ChatOpenAI({
      apiKey: this.configService.get<string>("llm.openai.apiKey"),
      model: this.configService.get<string>("llm.openai.model"),
      configuration: {
        baseURL: this.configService.get<string>("llm.openai.baseUrl"),
      },
      temperature: this.configService.get<number>("llm.openai.temp"),
    });
  }
}
