/**
 * Unified plugin: remark-to-slack-blocks
 * Converts MDAST (Markdown Abstract Syntax Tree) to Slack Block Kit format
 */

import type { SectionBlock } from "@slack/types";
import type { Content, Root } from "mdast";
import type { Compiler, Plugin } from "unified";
import type { Node } from "unist";

import {
  type BlockConversionOptions,
  combineSmallBlocks,
  convertBlockquote,
  convertCodeBlock,
  convertHeading,
  convertHtml,
  convertImage,
  convertParagraph,
  convertThematicBreak,
  convertUnknownBlock,
} from "./converters/block.converter";
import {
  convertList,
  type ListConversionOptions,
} from "./converters/list.converter";
// Import converters
import {
  convertTable,
  type TableConversionOptions,
} from "./converters/table.converter";
import type { ExtendedBlock } from "./types";
// Import validation
import {
  checkMessageSize,
  DEFAULT_SLACK_CONSTRAINTS,
  type SlackConstraints,
  validateSlackBlocks,
} from "./utils/validation";

/**
 * Configuration options for the plugin
 */
export interface SlackFormatterOptions {
  // Table options
  table: TableConversionOptions;

  // List options
  list: ListConversionOptions;

  // Block conversion options
  blocks: BlockConversionOptions;

  // Validation constraints
  constraints: SlackConstraints;

  // Processing options
  combineSmallBlocks: boolean;
  validateOutput: boolean;

  // Error handling
  strictMode: boolean;
  fallbackToText: boolean;
}

/**
 * Default plugin options
 */
export const DEFAULT_OPTIONS: SlackFormatterOptions = {
  table: {
    maxColumns: 100,
    fallbackToCodeBlock: false,
    preserveAlignment: false,
  },

  list: {
    preserveTaskLists: true,
    bulletStyle: "bullet",
    checkboxSymbols: {
      checked: "✅",
      unchecked: "☐",
    },
  },

  blocks: {
    combineAdjacentText: true,
    preserveLineBreaks: false,
  },

  constraints: DEFAULT_SLACK_CONSTRAINTS,

  combineSmallBlocks: true,
  validateOutput: true,

  strictMode: false,
  fallbackToText: true,
};

/**
 * Result interface for the compiler
 */
export interface SlackBlocksResult {
  blocks: ExtendedBlock[];
  errors: string[];
  warnings: string[];
}

/**
 * Main unified plugin function with compiler
 */
const remarkToSlackBlocks: Plugin<
  [Partial<SlackFormatterOptions>?],
  Root,
  string
> = function (options: Partial<SlackFormatterOptions> = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Set up the compiler function
  const compiler: Compiler<Node, string> = function (node: Node) {
    // Ensure we have a Root node
    const tree = node as Root;
    const errors: string[] = [];
    const warnings: string[] = [];
    let blocks: ExtendedBlock[] = [];

    try {
      // Process each top-level node
      for (const child of tree.children) {
        try {
          const converted = convertNode(child, opts);
          if (converted && converted.length > 0) {
            blocks.push(...converted);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown conversion error";
          errors.push(`Error converting ${child.type}: ${errorMessage}`);

          if (opts.fallbackToText) {
            // Add a fallback text block
            const fallbackBlock = createFallbackBlock(child);
            if (fallbackBlock) {
              blocks.push(fallbackBlock);
              warnings.push(`Converted ${child.type} to fallback text block`);
            }
          }
        }
      }

      // Post-process blocks
      if (opts.combineSmallBlocks && blocks.length > 0) {
        try {
          blocks = combineSmallBlocks(blocks);
        } catch (error) {
          warnings.push(
            "Failed to combine small blocks: " +
              (error instanceof Error ? error.message : "Unknown error"),
          );
        }
      }

      // Validate output
      if (opts.validateOutput && blocks.length > 0) {
        try {
          const validation = validateSlackBlocks(blocks, opts.constraints);
          errors.push(...validation.errors);
          warnings.push(...validation.warnings);

          const sizeValidation = checkMessageSize(blocks);
          errors.push(...sizeValidation.errors);
          warnings.push(...sizeValidation.warnings);
        } catch (error) {
          warnings.push(
            "Failed to validate blocks: " +
              (error instanceof Error ? error.message : "Unknown error"),
          );
        }
      }

      // In strict mode, throw on errors
      if (opts.strictMode && errors.length > 0) {
        throw new Error(
          `Conversion failed in strict mode: ${errors.join("; ")}`,
        );
      }

      // Log warnings if any
      if (warnings.length > 0 && !opts.strictMode) {
        console.warn("Slack conversion warnings:", warnings);
      }

      // Return JSON string as required by unified compiler
      const result: SlackBlocksResult = {
        blocks,
        errors,
        warnings,
      };

      return JSON.stringify(result);
    } catch (error) {
      if (opts.strictMode) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown processing error";
      console.error(`Fatal processing error: ${errorMessage}`);

      if (opts.fallbackToText) {
        // Create a single fallback block with the entire content
        const result: SlackBlocksResult = {
          blocks: [createFallbackBlockFromTree(tree)],
          errors: [errorMessage],
          warnings: [],
        };
        return JSON.stringify(result);
      }

      const result: SlackBlocksResult = {
        blocks: [],
        errors: [errorMessage],
        warnings: [],
      };
      return JSON.stringify(result);
    }
  };

  // Attach the compiler to this plugin instance
  this.compiler = compiler;
};

/**
 * Converts a single MDAST node to Slack blocks
 */
function convertNode(
  node: Content,
  options: SlackFormatterOptions,
): ExtendedBlock[] {
  switch (node.type) {
    case "heading":
      return convertHeading(node as any);

    case "paragraph":
      return convertParagraph(node as any);

    case "blockquote":
      return convertBlockquote(node as any);

    case "list":
      return convertList(node as any, options.list);

    case "table":
      return convertTable(node as any, options.table);

    case "code":
      return convertCodeBlock(node as any);

    case "thematicBreak":
      return convertThematicBreak();

    case "image":
      return convertImage(node as any);

    case "html":
      return convertHtml(node as any);

    default:
      return convertUnknownBlock(node);
  }
}

/**
 * Creates a fallback text block for a failed node conversion
 */
function createFallbackBlock(node: Content): ExtendedBlock | null {
  try {
    // Extract text content and create a simple section block
    const text = extractTextFromNode(node);
    if (!text.trim()) {
      return null;
    }

    const sectionBlock: SectionBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: text.substring(0, 3000), // Respect Slack limits
      },
    };

    return sectionBlock;
  } catch {
    return null;
  }
}

/**
 * Creates a fallback block from the entire tree
 */
function createFallbackBlockFromTree(tree: Root): ExtendedBlock {
  const text = tree.children
    .map((child) => extractTextFromNode(child))
    .join("\n\n");

  const sectionBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: text.substring(0, 3000) || "Failed to convert content",
    },
  };

  return sectionBlock;
}

/**
 * Extracts text content from any MDAST node
 */
function extractTextFromNode(node: Content): string {
  if (node.type === "text") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (node as any).value || "";
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if ("children" in node && Array.isArray((node as any).children)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
    return (
      node.children
        .map((child) => extractTextFromNode(child))
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        .join("")
    );
  }

  if ("value" in node) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (node as any).value || "";
  }

  return "";
}

/**
 * Export the plugin as default and named export
 */
export default remarkToSlackBlocks;
export { remarkToSlackBlocks };

/**
 * Standalone conversion function for direct use (backward compatibility)
 */
export async function markdownToBlocks(
  markdown: string,
  options: Partial<SlackFormatterOptions> = {},
): Promise<ExtendedBlock[]> {
  const { unified } = await import("unified");
  const { default: remarkParse } = await import("remark-parse");
  const { default: remarkGfm } = await import("remark-gfm");

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkToSlackBlocks, options);

  const result = await processor.process(markdown);
  const parsed = JSON.parse(String(result)) as SlackBlocksResult;

  // Handle errors/warnings if needed
  if (parsed.errors.length > 0) {
    console.warn("Conversion errors:", parsed.errors);
  }
  if (parsed.warnings.length > 0) {
    console.warn("Conversion warnings:", parsed.warnings);
  }

  return parsed.blocks;
}
