/**
 * Text converter for MDAST inline nodes to Slack rich text elements
 */

import type { RichTextElement, RichTextLink, RichTextText } from "@slack/types";
import type {
  Break,
  Content,
  Delete,
  Emphasis,
  InlineCode,
  Link,
  Strong,
  Text,
} from "mdast";

/**
 * Converts an array of inline MDAST nodes to Slack rich text elements
 */
export function convertInlineNodes(nodes: Content[]): RichTextElement[] {
  const elements: RichTextElement[] = [];

  for (const node of nodes) {
    const converted = convertInlineNode(node);
    if (converted) {
      if (Array.isArray(converted)) {
        elements.push(...converted);
      } else {
        elements.push(converted);
      }
    }
  }

  return elements;
}

/**
 * Converts a single inline MDAST node to Slack rich text element(s)
 */
function convertInlineNode(
  node: Content,
): RichTextElement | RichTextElement[] | null {
  switch (node.type) {
    case "text":
      return convertText(node);

    case "strong":
      return convertStrong(node);

    case "emphasis":
      return convertEmphasis(node);

    case "delete":
      return convertDelete(node);

    case "inlineCode":
      return convertInlineCode(node);

    case "link":
      return convertLink(node);

    case "break":
      return convertBreak(node);

    default:
      // For unknown inline types, try to extract text
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ("value" in node && typeof (node as any).value === "string") {
        return {
          type: "text",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          text: (node as any).value,
        } as RichTextText;
      }

      // If it has children, process them
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ("children" in node && Array.isArray((node as any).children)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return convertInlineNodes((node as any).children);
      }

      return null;
  }
}

/**
 * Converts text node to Slack rich text element
 */
function convertText(node: Text): RichTextText {
  return {
    type: "text",
    text: node.value,
  };
}

/**
 * Converts strong (bold) node to Slack rich text element
 */
function convertStrong(node: Strong): RichTextElement[] {
  const childElements = convertInlineNodes(node.children);

  // Apply bold style to all child elements
  return childElements.map((element) => ({
    ...element,
    style: {
      ...("style" in element ? element.style : {}),
      bold: true,
    },
  }));
}

/**
 * Converts emphasis (italic) node to Slack rich text element
 */
function convertEmphasis(node: Emphasis): RichTextElement[] {
  const childElements = convertInlineNodes(node.children);

  // Apply italic style to all child elements
  return childElements.map((element) => ({
    ...element,
    style: {
      ...("style" in element ? element.style : {}),
      italic: true,
    },
  }));
}

/**
 * Converts delete (strikethrough) node to Slack rich text element
 */
function convertDelete(node: Delete): RichTextElement[] {
  const childElements = convertInlineNodes(node.children);

  // Apply strikethrough style to all child elements
  return childElements.map((element) => ({
    ...element,
    style: {
      ...("style" in element ? element.style : {}),
      strike: true,
    },
  }));
}

/**
 * Converts inline code node to Slack rich text element
 */
function convertInlineCode(node: InlineCode): RichTextText {
  return {
    type: "text",
    text: node.value,
    style: {
      code: true,
    },
  };
}

/**
 * Converts link node to Slack rich text link element
 */
function convertLink(node: Link): RichTextLink {
  const text = node.children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");

  return {
    type: "link",
    url: node.url,
    text: text || node.url,
  };
}

/**
 * Converts break node to Slack rich text element
 */
function convertBreak(node: Break): RichTextText {
  return {
    type: "text",
    text: "\n",
  };
}

/**
 * Creates a rich text section from MDAST content nodes
 */
export function createRichTextSection(nodes: Content[]): {
  type: "rich_text_section";
  elements: RichTextElement[];
} {
  return {
    type: "rich_text_section",
    elements: convertInlineNodes(nodes),
  };
}

/**
 * Checks if nodes contain only plain text (no formatting)
 */
export function isPlainTextOnly(nodes: Content[]): boolean {
  return nodes.every((node) => node.type === "text" || node.type === "break");
}

/**
 * Extracts plain text from inline nodes, ignoring formatting
 */
export function extractPlainText(nodes: Content[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }
      if (node.type === "break") {
        return "\n";
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ("children" in node && Array.isArray((node as any).children)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return extractPlainText((node as any).children);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ("value" in node && typeof (node as any).value === "string") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        return (node as any).value;
      }
      return "";
    })
    .join("");
}

/**
 * Optimizes rich text elements by merging adjacent text elements with same styling
 */
export function optimizeRichTextElements(
  elements: RichTextElement[],
): RichTextElement[] {
  if (elements.length <= 1) {
    return elements;
  }

  const optimized: RichTextElement[] = [];
  let current = elements[0];

  for (let i = 1; i < elements.length; i++) {
    const next = elements[i];

    // If both are text elements with same styling, merge them
    if (
      current.type === "text" &&
      next.type === "text" &&
      stylesMatch(current.style, next.style)
    ) {
      current = {
        ...current,
        text: current.text + next.text,
      };
    } else {
      optimized.push(current);
      current = next;
    }
  }

  optimized.push(current);
  return optimized;
}

/**
 * Checks if two style objects are equivalent
 */
function stylesMatch(style1: any, style2: any): boolean {
  if (!style1 && !style2) return true;
  if (!style1 || !style2) return false;

  const keys1 = Object.keys(style1);
  const keys2 = Object.keys(style2);

  if (keys1.length !== keys2.length) return false;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return keys1.every((key) => style1[key] === style2[key]);
}
