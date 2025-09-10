import { ChatBedrockConverse } from "@langchain/aws";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { PrimaryChatModelPort } from "../../ports/primary-model.port";

@Injectable()
export class BedrockConverseModelProviderService
  implements PrimaryChatModelPort, OnModuleInit
{
  private readonly logger = new Logger(
    BedrockConverseModelProviderService.name,
  );
  public model!: ChatBedrockConverse;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.logger.debug("registering the bedrock-converse model");
    this.model = new ChatBedrockConverse({
      model: this.configService.get<string>("llm.bedrock-converse.model"),
      region: this.configService.get<string>("llm.bedrock-converse.region"),
      temperature: this.configService.get<number>("llm.bedrock-converse.temp"),
    });
  }
}
