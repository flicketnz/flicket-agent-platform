import { Injectable, Logger } from "@nestjs/common";
import { Block } from "@slack/types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import {
  remarkToSlackBlocks,
  type SlackFormatterOptions,
} from "./plugins/remark-to-slack-blocks";

@Injectable()
export class SlackFormatter {
  private readonly logger = new Logger(SlackFormatter.name);

  private pipeline(options?: Partial<SlackFormatterOptions>) {
    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkToSlackBlocks, options);
  }
  /**
   * Enhanced parse method using the new plugin architecture
   */
  public async parse(
    message: string,
    options: Partial<SlackFormatterOptions> = {},
  ): Promise<Block[]> {
    try {
      this.logger.debug("Parsing markdown message with enhanced formatter");

      const vFileResult = await this.pipeline({
        ...options,
      } satisfies Partial<SlackFormatterOptions>).process(message);
      const blocks = (
        JSON.parse(vFileResult.value as string) as { blocks?: Block[] }
      ).blocks;
      // this.logger.debug("blocks", blocks);

      if (!blocks) {
        this.logger.debug({ vFileResult: vFileResult.value });
      }

      if (this.validateBlocks(blocks)) {
        this.logger.debug(`Successfully converted to ${blocks.length} blocks`);
        return blocks;
      }
      throw new Error("Error validating produced blocks");
    } catch (error) {
      this.logger.error("Enhanced parsing failed:", error);
      return this.createFallbackBlocks(message);
    }
  }

  /**
   * Creates fallback blocks when parsing fails
   */
  private createFallbackBlocks(message: string): Block[] {
    this.logger.warn("Creating fallback blocks for failed parsing");

    const blocks: Block[] = [];

    // Split message into chunks that fit Slack's limits
    const chunks = this.chunkMessage(message, 3000);

    chunks.forEach((chunk) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: chunk,
        },
      } as Block);
    });

    return blocks.length > 0 ? blocks : this.getDefaultErrorBlock();
  }

  /**
   * Chunks a message into smaller pieces
   */
  private chunkMessage(message: string, maxLength: number): string[] {
    if (message.length <= maxLength) {
      return [message];
    }

    const chunks: string[] = [];
    let current = "";
    const lines = message.split("\n");

    for (const line of lines) {
      if (current.length + line.length + 1 <= maxLength) {
        current += (current ? "\n" : "") + line;
      } else {
        if (current) {
          chunks.push(current);
          current = line;
        } else {
          // Line is too long, force split
          chunks.push(line.substring(0, maxLength));
          current = line.substring(maxLength);
        }
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  /**
   * Validates that the result is a proper array of Slack blocks
   */
  private validateBlocks(blocks: any): blocks is Block[] {
    if (!Array.isArray(blocks)) {
      return false;
    }

    return blocks.every(
      (block: any) =>
        block &&
        typeof block === "object" &&
        "type" in block &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        typeof block.type === "string",
    );
  }

  /**
   * Gets a default error block
   */
  private getDefaultErrorBlock(): Block[] {
    return [
      {
        type: "section",
        text: {
          type: "plain_text",
          text: "Failed to parse message content.",
        },
      } as Block,
    ];
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use parse() instead
   */
  public async parseWithFabricMack(message: string): Promise<Block[]> {
    this.logger.warn("parseWithFabricMack is deprecated, use parse() instead");
    return this.parse(message);
  }
}
