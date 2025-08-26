/**
 * List converter for MDAST list nodes to Slack rich text lists
 */

import type { Block, RichTextBlock, SectionBlock } from "@slack/types";
import type { List, ListItem } from "mdast";

import { extractTextContent } from "../utils/text-extraction";
import { createRichTextSection } from "./text.converter";

export interface ListConversionOptions {
  preserveTaskLists: boolean;
  bulletStyle: "bullet" | "ordered";
  checkboxSymbols: {
    checked: string;
    unchecked: string;
  };
}

export const DEFAULT_LIST_OPTIONS: ListConversionOptions = {
  preserveTaskLists: true,
  bulletStyle: "bullet",
  checkboxSymbols: {
    checked: "✅",
    unchecked: "☐",
  },
};

/**
 * Converts MDAST list node to Slack rich text list block
 */
export function convertList(
  node: List,
  options: ListConversionOptions = DEFAULT_LIST_OPTIONS,
): Block[] {
  if (!node.children || node.children.length === 0) {
    return [];
  }

  try {
    const richTextBlock: RichTextBlock = {
      type: "rich_text",
      elements: [
        {
          type: "rich_text_list",
          style: node.ordered ? "ordered" : "bullet",
          elements: node.children.map((item: ListItem) =>
            createRichTextSection(item.children),
          ),
        },
      ],
    };

    return [richTextBlock];
  } catch (error) {
    // Fallback to simple text representation
    return convertListToTextBlock(node, options);
  }
}

/**
 * Converts list to a simple text block as fallback
 */
function convertListToTextBlock(
  node: List,
  options: ListConversionOptions,
): Block[] {
  const lines = node.children.map((item: ListItem, index: number) => {
    const text = extractTextContent(item.children);
    const prefix = node.ordered ? `${index + 1}.` : "•";

    // Handle task lists
    if (typeof item.checked === "boolean") {
      const symbol = item.checked
        ? options.checkboxSymbols.checked
        : options.checkboxSymbols.unchecked;
      return `${symbol} ${text}`;
    }

    return `${prefix} ${text}`;
  });

  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: lines.join("\n"),
    },
  };

  return [sectionBlock];
}
