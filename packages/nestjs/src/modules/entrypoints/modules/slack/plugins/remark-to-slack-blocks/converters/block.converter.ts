/**
 * Block converter for MDAST block nodes to Slack blocks
 */

import type {
  Block,
  DividerBlock,
  HeaderBlock,
  ImageBlock,
  RichTextBlock,
  SectionBlock,
} from "@slack/types";
import type {
  Blockquote,
  Code,
  Content,
  Heading,
  Html,
  Image,
  Paragraph,
} from "mdast";

import { extractTextContent } from "../utils/text-extraction";
import { createRichTextSection } from "./text.converter";

export interface BlockConversionOptions {
  combineAdjacentText: boolean;
  preserveLineBreaks: boolean;
}

export const DEFAULT_BLOCK_OPTIONS: BlockConversionOptions = {
  combineAdjacentText: true,
  preserveLineBreaks: false,
};

/**
 * Converts heading node to Slack header block
 */
export function convertHeading(node: Heading): Block[] {
  const text = extractTextContent(node.children);

  if (!text.trim()) {
    return [];
  }

  // Use header block for level 1-2, section for others
  if (node.depth <= 2) {
    const headerBlock: HeaderBlock = {
      type: "header",
      text: {
        type: "plain_text",
        text: text.substring(0, 150), // Slack header limit
      },
    };
    return [headerBlock];
  } else {
    const sectionBlock: SectionBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${text}*`,
      },
    };
    return [sectionBlock];
  }
}

/**
 * Converts paragraph node to Slack section block
 */
export function convertParagraph(node: Paragraph): Block[] {
  if (!node.children || node.children.length === 0) {
    return [];
  }

  const richTextSection = createRichTextSection(node.children);

  const richTextBlock: RichTextBlock = {
    type: "rich_text",
    elements: [richTextSection],
  };

  return [richTextBlock];
}

/**
 * Converts blockquote node to Slack rich text quote
 */
export function convertBlockquote(node: Blockquote): Block[] {
  if (!node.children || node.children.length === 0) {
    return [];
  }

  const text = extractTextContent(node.children);

  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `> ${text}`,
    },
  };

  return [sectionBlock];
}

/**
 * Converts code block to Slack section with preformatted text
 */
export function convertCodeBlock(node: Code): Block[] {
  const codeText = node.value || "";

  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`\`\`${node.lang || ""}\n${codeText}\n\`\`\``,
    },
  };

  return [sectionBlock];
}

/**
 * Converts thematic break to Slack divider
 */
export function convertThematicBreak(): Block[] {
  const dividerBlock: DividerBlock = {
    type: "divider",
  };
  return [dividerBlock];
}

/**
 * Converts image node to Slack image block
 */
export function convertImage(node: Image): Block[] {
  if (!node.url) {
    return [];
  }

  const imageBlock: ImageBlock = {
    type: "image",
    image_url: node.url,
    alt_text: node.alt || "Image",
  };

  if (node.title) {
    imageBlock.title = {
      type: "plain_text",
      text: node.title,
    };
  }

  return [imageBlock];
}

/**
 * Converts HTML node to text representation
 */
export function convertHtml(node: Html): Block[] {
  // For now, just show the HTML as code
  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`\`\`html\n${node.value}\n\`\`\``,
    },
  };

  return [sectionBlock];
}

/**
 * Handles unknown block types
 */
export function convertUnknownBlock(node: Content): Block[] {
  const text = extractTextContent([node]);

  if (!text.trim()) {
    return [];
  }

  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: text,
    },
  };

  return [sectionBlock];
}

/**
 * Combines small adjacent text blocks
 */
export function combineSmallBlocks(blocks: Block[]): Block[] {
  if (blocks.length <= 1) {
    return blocks;
  }

  const combined: Block[] = [];
  let currentSection: SectionBlock | null = null;

  for (const block of blocks) {
    if (block.type === "section" && "text" in block) {
      const sectionBlock = block as SectionBlock;

      if (
        currentSection &&
        currentSection.text?.type === sectionBlock.text?.type &&
        !currentSection.accessory &&
        !sectionBlock.accessory
      ) {
        // Combine with current section
        if (currentSection.text && sectionBlock.text) {
          currentSection.text.text += "\n\n" + sectionBlock.text.text;
        }
      } else {
        // Start new section
        if (currentSection) {
          combined.push(currentSection);
        }
        currentSection = { ...sectionBlock };
      }
    } else {
      // Non-section block, push current section and this block
      if (currentSection) {
        combined.push(currentSection);
        currentSection = null;
      }
      combined.push(block);
    }
  }

  // Don't forget the last section
  if (currentSection) {
    combined.push(currentSection);
  }

  return combined;
}
