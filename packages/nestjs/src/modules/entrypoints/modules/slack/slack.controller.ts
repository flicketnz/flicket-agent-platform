import { Controller, Logger } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { SayArguments, SlackEventMiddlewareArgs } from "@slack/bolt";
import { Message } from "nestjs-slack-bolt";
import { SlackService } from "nestjs-slack-bolt/dist/services/slack.service";

import { LlmConversationQuery } from "../../../../common/queries/llm-conversation.query";

@Controller("slack")
export class SlackEntrypointController {
  private readonly logger = new Logger(SlackEntrypointController.name);

  constructor(
    private readonly queryBus: QueryBus,
    private slackService: SlackService,
  ) {}

  // Handle _any_ Message event :-/
  @Message("")
  async handleMessageEvent(args: SlackEventMiddlewareArgs<"message">) {
    const threadTs = args.message.event_ts;

    if (isDirectMessage(args) && isThread(args) && isMessageText(args)) {
      return this.handleDirectAssistantMessageEvent(args);
    }
    await args.say({ text: "Hello", thread_ts: threadTs });
  }

  private async handleDirectAssistantMessageEvent(
    args: SlackEventMiddlewareArgs<"message"> & { message: { text: string } },
  ) {
    try {
      // Extract message details with safe property access
      const message = args.message.text;
      const userId =
        ("user" in args.message ? args.message.user : undefined) ||
        "unknown-user";
      const channelId = args.message.channel;
      const threadTs =
        "thread_ts" in args.message ? args.message.thread_ts : undefined;
      const eventTs = args.message.event_ts;

      // Create a session ID based on the thread or event
      const sessionId = `slack-${channelId}-${threadTs || eventTs}`;

      this.logger.log(
        `Processing message from user ${userId} in channel ${channelId}`,
      );

      // Execute initially
      if (threadTs) {
        this.setThreadStatus(channelId, threadTs);
      }
      // Then every 5 seconds
      const statusUpdater: NodeJS.Timeout | undefined = setInterval(() => {
        if (threadTs) {
          this.setThreadStatus(channelId, threadTs);
        }
      }, 5000);

      // Create the LLM conversation query
      const query = LlmConversationQuery.createForSlack(
        message,
        sessionId,
        userId,
        channelId,
        threadTs,
        {
          systemPrompt: `You're an assistant in a Slack workspace.
Users in the workspace will ask you to help them write something or to think better about a specific topic.
You'll respond to those questions in a professional way.
When a prompt has Slack's special syntax like <@USER_ID> or <#CHANNEL_ID>, you must keep them as-is if you use it in your response.
Responses should be limited to 1-2 paragraphs, and should not be too verbose. The exception to this is when the user asks for a detailed explanation or a long-form response.

Message Formatting: messages should be formatted ONLY wwith slack 'mrkdwn' syntax. Examples: 
_italic_, *bold*, ~strike~. 
Line break by including '\n' . 
block quotes by preceding a line with '>'. 
inline code by surrounding with '\`', \`\`\`This is a code block\nAnd it's multi-line\`\`\` 
you can add links by including the url as is, or named links like this: <http://www.example.com|This message *is* a link>. 
you may also use any unicode emojis
you MAY NOT use any heading syntax`,

          progressCallback: (progressMessage: string, stage?: string) => {
            // Optional: Send typing indicator or progress updates
            this.logger.debug(`LLM Progress [${stage}]: ${progressMessage}`);
          },
        },
      );

      // Execute the query using CQRS
      const response = await this.queryBus.execute(query);

      clearTimeout(statusUpdater);

      // Send the response back to Slack
      if (typeof response.content === "string") {
        this.logger.debug("Sending simple slack text response");

        await args.say({
          text: response.content,
          thread_ts: threadTs,
        });
      } else {
        // Complex return type
        this.logger.debug(
          "Setting up slack blocks for a complex message return type",
        );
        const sayArgs: SayArguments = {
          channel: args.message.channel,
          thread_ts: threadTs,
          blocks: [],
        };

        for (const messageContent of response.content) {
          if (messageContent.type === "text") {
            if (sayArgs.text === undefined) {
              sayArgs.text = messageContent.text as string;
            }
            sayArgs.blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: messageContent.text as string,
              },
            });
          } else if (messageContent.type === "image_url") {
            sayArgs.blocks.push({
              type: "image",
              image_url:
                typeof messageContent.image_url === "string"
                  ? messageContent.image_url
                  : (messageContent.image_url as { url: string }).url,
            });
          }
        }
        this.logger.debug("sayArgs", sayArgs);
        await args.say(sayArgs);
      }
      this.logger.log(`Successfully processed message.`);
    } catch (error) {
      this.logger.error("Error processing message:", error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const threadTs =
        "thread_ts" in args.message ? args.message.thread_ts : undefined;

      await args.say({
        text: `Sorry, I encountered an error: ${errorMessage}`,
        thread_ts: threadTs,
      });
    }
  }
  private setThreadStatus(channelId: string, threadTs: string) {
    const statuses = [
      "Thinking...",
      "Powering up the mainframe...",
      "Loading the flux capacitor...",
      "Cranking the handle...",
      "Summoning the AI spirits...",
      "Consulting the oracle...",
      "Engaging hyperdrive...",
      "Initializing the neural network...",
      "Activating the AI core...",
      "Booting up the AI...",
      "Preparing the quantum computer...",
      "Aligning the stars...",
      "Charging the AI batteries...",
      "Tuning the AI antenna...",
      "Calibrating the AI sensors...",
    ];

    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    void this.slackService.client.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status: randomStatus,
    });
  }
}

/**
 * Checks if message was sent to a bot user.
 *
 * Technically, this check would match a message sent to _any_ user, however we dont (cant) receive messages sent to other users, therefore this must be a bot user.
 *
 * @param args
 * @returns {boolean} true if the message was sent to a bot user
 */
const isDirectMessage = (args: SlackEventMiddlewareArgs<"message">) => {
  return args.message.channel?.startsWith("D");
};
/**
 *
 * @param args
 * @returns {boolean} true if the message is in a thread
 */
const isThread = (args: SlackEventMiddlewareArgs<"message">) => {
  return "thread_ts" in args.message && args.message.thread_ts;
};

/**
 *
 * @param args
 * @returns {boolean} true is the message has text
 */
/**
 * Checks if the message has text content.
 *
 * @param args
 * @returns {boolean} true if the message has text
 */
const isMessageText = (
  args: SlackEventMiddlewareArgs<"message">,
): args is SlackEventMiddlewareArgs<"message"> & {
  message: { text: string };
} => {
  return (
    "text" in args.message &&
    typeof args.message.text === "string" &&
    args.message.text.length > 0
  );
};
