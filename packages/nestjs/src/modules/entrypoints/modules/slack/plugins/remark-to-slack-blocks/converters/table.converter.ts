/**
 * Table converter for MDAST table nodes to Slack table blocks
 */

import type { Block, SectionBlock } from "@slack/types";
import type { Content, Table, TableCell, TableRow } from "mdast";

import type {
  RawTextCell,
  RichTextCell,
  TableBlock,
  TableCell as SlackTableCell,
  TableColumnSetting,
} from "../types";
import { extractTextContent } from "../utils/text-extraction";
import { convertInlineNodes } from "./text.converter";

export interface TableConversionOptions {
  maxColumns: number;
  /**
   * When table has more that maxColumns, fallbackToCodeBlock: true, table renders as a code block. fallbackToCodeBlock: false, table is truncated at maxColumns
   */
  fallbackToCodeBlock: boolean;
  preserveAlignment: boolean;
}

/**
 * Converts MDAST table node to Slack table block
 */
export function convertTable(
  node: Table,
  options: TableConversionOptions,
): Block[] {
  // Validate table structure
  if (!node.children || node.children.length === 0) {
    return [];
  }

  const firstRow = node.children[0];
  if (!firstRow.children || firstRow.children.length === 0) {
    return [];
  }

  const columnCount = firstRow.children.length;

  // Check if table exceeds Slack constraints
  if (columnCount > options.maxColumns) {
    if (options.fallbackToCodeBlock) {
      return [convertTableToCodeBlock(node)];
    }
    // Truncate table to fit constraints
    return [convertTruncatedTable(node, options.maxColumns)];
  }

  try {
    return [convertToTableBlock(node, options)];
  } catch (error) {
    // Fallback to code block if conversion fails
    console.warn("Table conversion failed, falling back to code block:", error);
    return [convertTableToCodeBlock(node)];
  }
}

/**
 * Converts table to Slack table block
 */
function convertToTableBlock(
  node: Table,
  options: TableConversionOptions,
): TableBlock {
  const rows = node.children;

  // Determine the expected column count from the first row
  const firstRow = rows[0];
  const expectedColumns = firstRow.children.length;

  // Convert all rows and normalize column counts
  const slackRows = rows.map((row: TableRow, rowIndex: number) => {
    let cells = row.children.map((cell: TableCell) =>
      convertTableCellContent(cell.children),
    );

    // Normalize row length to match expected columns
    if (cells.length < expectedColumns) {
      // Pad with empty cells
      const emptyCells = Array(expectedColumns - cells.length)
        .fill(null)
        .map(() => ({
          type: "raw_text" as const,
          text: "&nbsp;",
        }));
      cells = [...cells, ...emptyCells];
    } else if (cells.length > expectedColumns) {
      // Truncate extra cells
      cells = cells.slice(0, expectedColumns);
      console.warn(
        `Table row ${rowIndex} truncated from ${row.children.length} to ${expectedColumns} columns`,
      );
    }

    return cells;
  });

  // Create column settings based on alignment
  const columnSettings: TableColumnSetting[] = [];
  if (node.align && options.preserveAlignment) {
    // Ensure column settings match the expected column count
    const alignments = node.align.slice(0, expectedColumns);
    while (alignments.length < expectedColumns) {
      alignments.push(null); // Default alignment
    }

    columnSettings.push(
      ...alignments.map((align) => ({
        align: align || "left",
        is_wrapped: true,
      })),
    );
  }

  return {
    type: "table",
    column_settings: columnSettings.length > 0 ? columnSettings : undefined,
    rows: slackRows,
  };
}

/**
 * Converts table cell content to Slack table cell
 */
function convertTableCellContent(nodes: Content[]): SlackTableCell {
  if (!nodes || nodes.length === 0) {
    const rawCell: RawTextCell = {
      type: "raw_text",
      text: "",
    };
    return rawCell;
  }

  const text = extractTextContent(nodes);

  // Check if cell has formatting - if so, use rich_text
  const hasFormatting = nodes.some((node) =>
    ["strong", "emphasis", "delete", "inlineCode", "link"].includes(node.type),
  );

  if (hasFormatting) {
    try {
      const richElements = convertInlineNodes(nodes);
      const richCell: RichTextCell = {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: richElements,
          },
        ],
      };
      return richCell;
    } catch (error) {
      // Fallback to raw text if rich text conversion fails
      const rawCell: RawTextCell = {
        type: "raw_text",
        text,
      };
      return rawCell;
    }
  } else {
    // Simple text cell
    const rawCell: RawTextCell = {
      type: "raw_text",
      text,
    };
    return rawCell;
  }
}

/**
 * Converts table to code block as fallback
 */
function convertTableToCodeBlock(node: Table): SectionBlock {
  const tableText = convertTableToMarkdownText(node);

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`\`\`\n${tableText}\n\`\`\``,
    },
  };
}

/**
 * Converts table to truncated version with fewer columns
 */
function convertTruncatedTable(node: Table, maxColumns: number): TableBlock {
  const rows = node.children;

  // Truncate each row to maxColumns
  const truncatedRows = rows.map((row: TableRow) => ({
    ...row,
    children: row.children.slice(0, maxColumns),
  }));

  const truncatedTable: Table = {
    ...node,
    children: truncatedRows,
  };

  return convertToTableBlock(truncatedTable, {
    maxColumns,
    fallbackToCodeBlock: false,
    preserveAlignment: false,
  });
}

/**
 * Converts table to markdown text representation
 */
function convertTableToMarkdownText(node: Table): string {
  const rows = node.children;

  if (rows.length === 0) {
    return "";
  }

  const lines: string[] = [];

  // Convert each row
  rows.forEach((row: TableRow, rowIndex: number) => {
    const cells = row.children.map((cell: TableCell) => {
      const text = extractTextContent(cell.children);
      return text.replace(/\n/g, " ").trim();
    });

    lines.push(`| ${cells.join(" | ")} |`);

    // Add separator after header row
    if (rowIndex === 0 && rows.length > 1) {
      const separator = cells.map(() => "---").join(" | ");
      lines.push(`| ${separator} |`);
    }
  });

  return lines.join("\n");
}

/**
 * Estimates the visual width of a table for layout decisions
 */
export function estimateTableWidth(node: Table): number {
  const rows = node.children;
  if (rows.length === 0) return 0;

  const firstRow = rows[0];
  let totalWidth = 0;

  firstRow.children.forEach((cell: TableCell) => {
    const text = extractTextContent(cell.children);
    totalWidth += Math.max(text.length, 3); // Minimum 3 chars per column
  });

  // Add separators and padding
  totalWidth += (firstRow.children.length - 1) * 3; // " | " between columns
  totalWidth += 4; // "| " at start and " |" at end

  return totalWidth;
}

/**
 * Checks if table content is simple enough for table block
 */
export function isTableSimpleEnough(node: Table): boolean {
  const rows = node.children;

  return rows.every((row: TableRow) =>
    row.children.every((cell: TableCell) =>
      cell.children.every((child: Content) =>
        // Only allow simple inline content
        ["text", "strong", "emphasis", "inlineCode"].includes(child.type),
      ),
    ),
  );
}

/**
 * Validates table structure before conversion
 */
export function validateTableStructure(node: Table): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!node.children || node.children.length === 0) {
    issues.push("Table has no rows");
    return { isValid: false, issues };
  }

  const rows = node.children;
  const headerRow = rows[0];

  if (!headerRow.children || headerRow.children.length === 0) {
    issues.push("Header row has no columns");
    return { isValid: false, issues };
  }

  const expectedColumns = headerRow.children.length;

  // Check for consistent column counts
  rows.forEach((row: TableRow, index: number) => {
    if (!row.children || row.children.length !== expectedColumns) {
      issues.push(
        `Row ${index} has ${row.children?.length || 0} columns, expected ${expectedColumns}`,
      );
    }
  });

  return {
    isValid: issues.length === 0,
    issues,
  };
}
