/**
 * Text extraction utilities for MDAST nodes
 */

import type { Content, Parent } from "mdast";

/**
 * Extracts plain text content from MDAST nodes recursively
 */
export function extractTextContent(nodes: Content[]): string {
  return nodes.map((node) => extractTextFromNode(node)).join("");
}

/**
 * Extracts text from a single MDAST node
 */
export function extractTextFromNode(node: Content): string {
  switch (node.type) {
    case "text":
      return node.value;

    case "inlineCode":
      return node.value;

    case "break":
      return "\n";

    case "emphasis":
      return extractTextContent(node.children);

    case "strong":
      return extractTextContent(node.children);

    case "delete":
      return extractTextContent(node.children);

    case "link":
      return extractTextContent(node.children);

    case "image":
      return node.alt || "";

    default:
      // For any node with children, recursively extract text
      if ("children" in node && Array.isArray((node as Parent).children)) {
        return extractTextContent((node as Parent).children);
      }
      return "";
  }
}

/**
 * Checks if a node contains only plain text (no formatting)
 */
export function isPlainText(nodes: Content[]): boolean {
  return nodes.every((node) => {
    if (node.type === "text") {
      return true;
    }
    // If it has children, check recursively
    if ("children" in node && Array.isArray((node as Parent).children)) {
      return isPlainText((node as Parent).children);
    }
    return false;
  });
}

/**
 * Truncates text to fit Slack constraints while preserving word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Find the last space before the limit
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > 0 && lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated.substring(0, maxLength - 3) + "...";
}

/**
 * Sanitizes text for Slack by escaping special characters
 */
export function sanitizeForSlack(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Checks if text contains Slack-specific markup that should be preserved
 */
export function hasSlackMarkup(text: string): boolean {
  // Check for Slack mentions, channels, etc.
  const slackPatterns = [
    /<@[UW][A-Z0-9]+(\|[^>]+)?>/, // User mentions
    /<#[C][A-Z0-9]+(\|[^>]+)?>/, // Channel mentions
    /<![^>]+>/, // Special mentions (@here, @channel, etc.)
    /<https?:\/\/[^|>]+(\|[^>]+)?>/, // Links with labels
  ];

  return slackPatterns.some((pattern) => pattern.test(text));
}

/**
 * Normalizes whitespace in text content
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\r/g, "\n") // Normalize line endings
    .replace(/\n{3,}/g, "\n\n") // Limit consecutive newlines
    .replace(/[ \t]+/g, " ") // Normalize spaces and tabs
    .trim(); // Remove leading/trailing whitespace
}

/**
 * Converts inline nodes to plain text with basic formatting
 */
export function inlineNodesToText(nodes: Content[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;

        case "strong": {
          const strongText = extractTextContent(node.children);
          return `*${strongText}*`;
        }

        case "emphasis": {
          const emphasisText = extractTextContent(node.children);
          return `_${emphasisText}_`;
        }

        case "inlineCode":
          return `\`${node.value}\``;

        case "delete": {
          const strikeText = extractTextContent(node.children);
          return `~${strikeText}~`;
        }

        case "link": {
          const linkNode = node;
          const linkText = extractTextContent(linkNode.children);
          return `<${linkNode.url}|${linkText}>`;
        }

        case "break":
          return "\n";

        default:
          return extractTextFromNode(node);
      }
    })
    .join("");
}
