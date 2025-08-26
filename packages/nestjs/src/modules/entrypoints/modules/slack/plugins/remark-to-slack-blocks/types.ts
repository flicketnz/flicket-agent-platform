/**
 * Extended Slack Block Kit types for new/missing block types
 */

import type { Block } from "@slack/types";
import type { RichTextElement } from "@slack/types";

/**
 * Table block - extends the official Block interface
 * @see https://docs.slack.dev/reference/block-kit/blocks/table-block/
 */
export interface TableBlock extends Block {
  type: "table";
  /**
   * Settings for each column
   */
  column_settings?: TableColumnSetting[];
  /**
   * Array of table rows, where first row is the header
   */
  rows: TableCell[][];
}

/**
 * Column settings for table
 */
export interface TableColumnSetting {
  /**
   * Whether text in this column should wrap
   */
  is_wrapped?: boolean;
  /**
   * Text alignment for this column
   */
  align?: "left" | "center" | "right";
}

/**
 * Table cell definition - can be raw text or rich text
 */
export type TableCell = RawTextCell | RichTextCell;

/**
 * Simple text cell
 */
export interface RawTextCell {
  type: "raw_text";
  text: string;
}

/**
 * Rich text cell with formatting
 */
export interface RichTextCell {
  type: "rich_text";
  elements: RichTextSectionElement[];
}

/**
 * Rich text section element for table cells
 */
export interface RichTextSectionElement {
  type: "rich_text_section";
  elements: RichTextElement[];
}

/**
 * Validation constraints for Slack blocks
 */
export interface SlackConstraints {
  maxBlocks: number;
  maxHeaderLength: number;
  maxAltTextLength: number;
  maxTextLength: number;
  maxTableColumns: number;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Extended union type including our custom table block
 */
export type ExtendedBlock = Block | TableBlock;
