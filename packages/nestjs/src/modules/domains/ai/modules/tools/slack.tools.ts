import {
  BaseToolkit,
  StructuredToolInterface,
  tool,
} from "@langchain/core/tools";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack-bolt/dist/services/slack.service";
import * as z from "zod/v3";

import { type AiToolProvider, Tool } from "./ai-tools";

@Injectable()
@Tool()
export class SlackTool implements AiToolProvider, OnModuleInit {
  public tool!: BaseToolkit;
  private readonly logger = new Logger(SlackTool.name);

  constructor(
    private readonly configService: ConfigService,
    private slackService: SlackService,
  ) {}

  onModuleInit() {
    const enabled = this.configService.get<boolean>("llm.tools.slack.enabled");
    const toolList: StructuredToolInterface[] = [];

    if (enabled) {
      // Get slack user profile
      toolList.push(
        tool(
          async ({ userId }: { userId: string }) => {
            const profileResponse =
              await this.slackService.client.users.profile.get({
                user: userId,
              });
            if (profileResponse.ok) {
              return profileResponse.profile;
            } else {
              this.logger.error(profileResponse.error);
              this.logger.debug(profileResponse);

              return profileResponse.error;
            }
          },
          {
            name: "get-slack-user",
            description: "Get profile of the slack user by their userId",
            schema: z.object({
              userId: z.string(),
            }),
          },
        ),
      );

      // Search for canvas
      // TODO: searching does not appear to work as initialy expected when using a bot token. At best you can locate files that your bot has access to.

      // toolList.push(
      //   tool(
      //     async ({ page, query }: { query: string; page: number }) => {
      //       const searchResponse = await this.slackService.client.search.files({
      //         query,
      //         page,
      //       });

      //       if (searchResponse.ok) {
      //         return searchResponse.files;
      //       } else {
      //         this.logger.error(searchResponse.error);
      //         this.logger.debug(searchResponse);

      //         return searchResponse.error;
      //       }
      //     },
      //     {
      //       name: "search-slack-canvases",
      //       description: "Search for canvases in slack bases on an input query",
      //       schema: z.object({
      //         page: z
      //           .string()
      //           .describe(
      //             "page number of the search - incase there are many results and you need to paginate",
      //           ),
      //         query: z
      //           .string()
      //           .describe(
      //             "The search query to use when attempting to locate a canvas",
      //           ),
      //       }),
      //     },
      //   ),
      // );
    }

    this.tool = {
      tools: toolList,
      getTools: () => toolList,
    };
  }
}
