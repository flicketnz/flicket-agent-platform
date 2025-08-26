/**
 * Validation utilities for Slack blocks and constraints
 *
 * Note: This file intentionally uses 'any' types for block validation
 * since we need to validate unknown/dynamic block structures from external sources.
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import type { Block } from "@slack/types";

import type { SlackConstraints, ValidationResult } from "../types";

// Re-export types for easier access
export type { SlackConstraints, ValidationResult } from "../types";

/**
 * Default Slack constraints based on API limits
 */
export const DEFAULT_SLACK_CONSTRAINTS: SlackConstraints = {
  maxBlocks: 50, // Maximum blocks per message
  maxHeaderLength: 150, // Maximum header text length
  maxAltTextLength: 2000, // Maximum alt text length
  maxTextLength: 3000, // Maximum text length in section blocks
  maxTableColumns: 10, // Practical limit for table columns
};

/**
 * Validates an array of Slack blocks against constraints
 */
export function validateSlackBlocks(
  blocks: Block[],
  constraints: SlackConstraints = DEFAULT_SLACK_CONSTRAINTS,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check total block count
  if (blocks.length > constraints.maxBlocks) {
    errors.push(
      `Too many blocks: ${blocks.length} exceeds limit of ${constraints.maxBlocks}`,
    );
  }

  // Validate each block
  blocks.forEach((block, index) => {
    const blockResult = validateSingleBlock(block, constraints);

    // Add context to errors and warnings
    blockResult.errors.forEach((error) =>
      errors.push(`Block ${index} (${block.type}): ${error}`),
    );
    blockResult.warnings.forEach((warning) =>
      warnings.push(`Block ${index} (${block.type}): ${warning}`),
    );
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates a single Slack block
 */
function validateSingleBlock(
  block: Block,
  constraints: SlackConstraints,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (block.type) {
    case "header":
      validateHeaderBlock(block as any, constraints, errors, warnings);
      break;

    case "section":
      validateSectionBlock(block as any, constraints, errors, warnings);
      break;

    case "image":
      validateImageBlock(block as any, constraints, errors, warnings);
      break;

    case "table":
      validateTableBlock(block as any, constraints, errors, warnings);
      break;

    case "rich_text":
      validateRichTextBlock(block as any, constraints, errors, warnings);
      break;

    default:
      // Unknown block type - just warn
      warnings.push(`Unknown block type: ${block.type}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates header block
 */
function validateHeaderBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any,
  constraints: SlackConstraints,
  errors: string[],
  warnings: string[], // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
): void {
  if (!block.text?.text) {
    errors.push("Header block missing text");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.text.text.length > constraints.maxHeaderLength) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    errors.push(
      `Header text too long: ${String(block.text.text.length)} exceeds ${constraints.maxHeaderLength}`,
    );
  }
}

/**
 * Validates section block
 */
function validateSectionBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any,
  constraints: SlackConstraints,
  errors: string[],
  warnings: string[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!block.text && (!block.fields || block.fields.length === 0)) {
    errors.push("Section block must have either text or fields");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.text?.text && block.text.text.length > constraints.maxTextLength) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    errors.push(
      `Section text too long: ${String(block.text.text.length)} exceeds ${constraints.maxTextLength}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.fields && block.fields.length > 10) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    errors.push(
      `Too many fields: ${String(block.fields.length)} exceeds limit of 10`,
    );
  }
}

/**
 * Validates image block
 */
function validateImageBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any,
  constraints: SlackConstraints,
  errors: string[],
  warnings: string[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!block.image_url && !block.slack_file) {
    errors.push("Image block missing image_url or slack_file");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!block.alt_text) {
    errors.push("Image block missing alt_text");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.alt_text.length > constraints.maxAltTextLength) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    errors.push(
      `Alt text too long: ${String(block.alt_text.length)} exceeds ${constraints.maxAltTextLength}`,
    );
  }
}

/**
 * Validates table block (custom type)
 */
function validateTableBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any,
  constraints: SlackConstraints,
  errors: string[],
  warnings: string[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!block.rows || !Array.isArray(block.rows)) {
    errors.push("Table block missing rows array");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.rows.length === 0) {
    warnings.push("Table block has no rows");
    return;
  }

  // Check column consistency - this is critical for Slack tables
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  const firstRowColumns = block.rows[0]?.length || 0;

  if (firstRowColumns === 0) {
    errors.push("Table header row has no columns");
    return;
  }

  if (firstRowColumns > constraints.maxTableColumns) {
    warnings.push(
      `Table has ${String(firstRowColumns)} columns, may be too wide for mobile`,
    );
  }

  // Validate each row for consistent column count
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  block.rows.forEach((row: any, rowIndex: number) => {
    if (!Array.isArray(row)) {
      errors.push(`Row ${rowIndex} is not an array`);
      return;
    }

    // Critical check: all rows must have the same number of columns
    if (row.length !== firstRowColumns) {
      errors.push(
        `Row ${rowIndex} has ${String(row.length)} cells, expected ${String(firstRowColumns)}. Slack tables require consistent column counts.`,
      );
    }

    // Validate each cell structure
    row.forEach((cell: any, cellIndex: number) => {
      if (!cell || typeof cell !== "object") {
        errors.push(`Row ${rowIndex}, cell ${cellIndex} is not a valid object`);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (
        !cell.type ||
        (cell.type !== "raw_text" && cell.type !== "rich_text")
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        errors.push(
          `Row ${rowIndex}, cell ${cellIndex} has invalid type: ${String(cell.type)}. Must be 'raw_text' or 'rich_text'.`,
        );
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (cell.type === "raw_text") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (typeof cell.text !== "string") {
          errors.push(
            `Row ${rowIndex}, cell ${cellIndex} raw_text missing or invalid text property`,
          );
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (cell.type === "rich_text") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!cell.elements || !Array.isArray(cell.elements)) {
          errors.push(
            `Row ${rowIndex}, cell ${cellIndex} rich_text missing elements array`,
          );
        }
      }
    });
  });

  // Additional validation for column settings if present
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.column_settings && Array.isArray(block.column_settings)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (block.column_settings.length !== firstRowColumns) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      warnings.push(
        `Column settings count (${String(block.column_settings.length)}) doesn't match column count (${String(firstRowColumns)})`,
      );
    }
  }
}

/**
 * Validates rich text block
 */
function validateRichTextBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any,
  constraints: SlackConstraints,
  errors: string[],
  warnings: string[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!block.elements || !Array.isArray(block.elements)) {
    errors.push("Rich text block missing elements array");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (block.elements.length === 0) {
    warnings.push("Rich text block has no elements");
  }

  // Additional validation for rich text elements could go here
}

/**
 * Checks total message size constraints
 */
export function checkMessageSize(blocks: Block[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Estimate JSON size (rough approximation)
  const jsonString = JSON.stringify(blocks);
  const sizeInBytes = new TextEncoder().encode(jsonString).length;

  // Slack has various size limits, but generally messages should be under 40KB
  if (sizeInBytes > 40000) {
    errors.push(
      `Message too large: ${sizeInBytes} bytes exceeds recommended 40KB limit`,
    );
  } else if (sizeInBytes > 20000) {
    warnings.push(
      `Message is large: ${sizeInBytes} bytes, consider breaking into smaller messages`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that block IDs are unique within a message
 */
export function validateUniqueBlockIds(blocks: Block[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const blockIds = new Set<string>();

  blocks.forEach((block, index) => {
    if (block.block_id) {
      if (blockIds.has(block.block_id)) {
        errors.push(
          `Duplicate block_id "${block.block_id}" found at block ${index}`,
        );
      } else {
        blockIds.add(block.block_id);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Comprehensive validation of a complete Slack message
 */
export function validateSlackMessage(blocks: Block[]): ValidationResult {
  const results = [
    validateSlackBlocks(blocks),
    checkMessageSize(blocks),
    validateUniqueBlockIds(blocks),
  ];

  // Combine all results
  const allErrors = results.flatMap((r) => r.errors);
  const allWarnings = results.flatMap((r) => r.warnings);

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
