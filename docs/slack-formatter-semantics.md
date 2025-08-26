# Slack Formatter Markdown Semantics Specification

## Overview

This document defines the markdown semantics supported by the Flicket Agent
Platform's SlackFormatter service. The formatter converts AI agent responses
from markdown format to Slack Block Kit JSON format using a **custom unified
plugin** that processes MDAST (Markdown Abstract Syntax Tree) nodes.

**Primary Use Case:** Converting AI agent responses to properly formatted Slack
messages for internal staff consumption through the Slack integration.

**Implementation Strategy:** Custom unified plugin (`remark-to-slack-blocks`)
that processes MDAST nodes and converts them to Slack Block Kit format, with
full support for tables and other GFM features.

**Key Advantages:**

- Full table support using Slack's native table blocks
- Complete control over MDAST node processing
- Extensible architecture for custom formatting rules
- Better performance and reliability than third-party solutions

---

## Plugin Architecture

### Unified Pipeline Structure

```typescript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkToSlackBlocks from "./remark-to-slack-blocks"; // Custom plugin

export class SlackFormatter {
  private pipeline() {
    return unified().use(remarkParse).use(remarkGfm).use(remarkToSlackBlocks, {
      // Plugin options
      tableSupport: true,
      maxTableWidth: 5,
      checkboxStyle: "emoji",
    });
  }

  public async parse(message: string) {
    const result = await this.pipeline().process(message);
    return result.data.slackBlocks; // Array of Slack Block Kit blocks
  }
}
```

### Plugin Implementation Pattern

```typescript
export default function remarkToSlackBlocks(options = {}) {
  return function transformer(tree: Root, file: VFile) {
    const blocks: SlackBlock[] = [];

    // Process each top-level MDAST node
    for (const node of tree.children) {
      const slackBlock = convertMdastNodeToSlackBlock(node, options);
      if (slackBlock) {
        blocks.push(...(Array.isArray(slackBlock) ? slackBlock : [slackBlock]));
      }
    }

    // Attach blocks to file data
    file.data.slackBlocks = blocks;
  };
}
```

---

## Supported Markdown Features

### 1. Inline Text Formatting

#### Bold Text

**Markdown Syntax:**

```markdown
**bold text** **bold text**
```

**Slack Block Kit Mapping:**

- Converts to rich text with `style.bold: true`
- Maps to `rich_text_section` elements within `rich_text` blocks

**Example:**

```markdown
This is **important** information.
```

#### Italic Text

**Markdown Syntax:**

```markdown
_italic text_ _italic text_
```

**Slack Block Kit Mapping:**

- Converts to rich text with `style.italic: true`
- Maps to `rich_text_section` elements within `rich_text` blocks

#### Strikethrough Text

**Markdown Syntax:**

```markdown
~~strikethrough text~~
```

**Slack Block Kit Mapping:**

- Converts to rich text with `style.strike: true`
- Maps to `rich_text_section` elements within `rich_text` blocks

#### Inline Code

**Markdown Syntax:**

```markdown
`inline code`
```

**Slack Block Kit Mapping:**

- Converts to rich text with `style.code: true`
- Maps to `rich_text_section` elements within `rich_text` blocks

### 2. Links

#### Standard Links

**Markdown Syntax:**

```markdown
[Link Text](https://example.com)
[Link Text](https://example.com "Optional Title")
```

**Slack Block Kit Mapping:**

- Converts to `rich_text_link` elements
- `url` property contains the link destination
- `text` property contains the link text

#### Automatic Links

**Markdown Syntax:**

```markdown
https://example.com <https://example.com>
```

**Slack Block Kit Mapping:**

- Converts to `rich_text_link` elements
- URL serves as both `url` and `text` properties

### 3. Headers

**Markdown Syntax:**

```markdown
# Header 1

## Header 2

### Header 3

#### Header 4

##### Header 5

###### Header 6
```

**Slack Block Kit Mapping:**

- Converts to `header` blocks for H1-H3
- H4-H6 convert to `section` blocks with bold formatting
- `text` property contains the header content

**Limitations:**

- Slack Block Kit `header` blocks have a 150 character limit
- Headers longer than 150 characters automatically convert to `section` blocks

### 4. Lists

#### Unordered Lists

**Markdown Syntax:**

```markdown
- Item 1
- Item 2
  - Nested item

* Alternative syntax

- Another alternative
```

**Slack Block Kit Mapping:**

- Converts to `rich_text` blocks with `rich_text_list` elements
- `style: "bullet"` for unordered lists
- Supports up to 3 levels of nesting

#### Ordered Lists

**Markdown Syntax:**

```markdown
1. First item
2. Second item
   1. Nested item
```

**Slack Block Kit Mapping:**

- Converts to `rich_text` blocks with `rich_text_list` elements
- `style: "ordered"` for numbered lists
- Supports up to 3 levels of nesting

#### Checkbox Lists (Task Lists)

**Markdown Syntax:**

```markdown
- [ ] Unchecked item
- [x] Checked item
- [x] Also checked
```

**Slack Block Kit Mapping:**

- Converts to `rich_text` blocks with bullet lists
- Prefixes text with checkbox symbols (✅ for checked, ☐ for unchecked)
- Configurable checkbox prefixes (see Configuration Options)

### 5. Code Blocks

#### Fenced Code Blocks

**Markdown Syntax:**

````markdown
```javascript
const example = "code";
console.log(example);
```
````

````

**Slack Block Kit Mapping:**
- Converts to `section` blocks with `mrkdwn` text
- Wrapped in triple backticks for Slack's code formatting
- Language hints are preserved but not specially formatted

#### Indented Code Blocks
**Markdown Syntax:**
```markdown
    indented code block
    second line
````

**Slack Block Kit Mapping:**

- Converts to `section` blocks with `mrkdwn` text
- Wrapped in triple backticks

### 6. Block Quotes

**Markdown Syntax:**

```markdown
> This is a blockquote It can span multiple lines
>
> And have multiple paragraphs
```

**Slack Block Kit Mapping:**

- Converts to `section` blocks with `mrkdwn` text
- Each line prefixed with `>` character
- Maintains original formatting structure

### 7. Horizontal Rules (Dividers)

**Markdown Syntax:**

```markdown
---

---

---
```

**Slack Block Kit Mapping:**

- Converts to `divider` blocks
- No additional properties required

### 8. Images

**Markdown Syntax:**

```markdown
![Alt Text](https://example.com/image.png)
![Alt Text](https://example.com/image.png "Optional Title")
```

**Slack Block Kit Mapping:**

- Converts to `image` blocks
- `image_url` property contains the image URL
- `alt_text` property contains the alt text (required by Slack)

**Limitations:**

- Images must be publicly accessible URLs
- Slack has size and format restrictions
- Alt text is required and has a 2000 character limit

### 9. Tables (**Enhanced Support**)

**Markdown Syntax:**

```markdown
| Header 1 | Header 2 | Header 3 |
| -------- | -------- | -------- |
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

**MDAST Node Structure:**

```typescript
{
  type: 'table',
  align: [null, null, null], // or 'left', 'right', 'center'
  children: [
    {
      type: 'tableRow',
      children: [
        { type: 'tableCell', children: [{ type: 'text', value: 'Header 1' }] },
        { type: 'tableCell', children: [{ type: 'text', value: 'Header 2' }] },
        { type: 'tableCell', children: [{ type: 'text', value: 'Header 3' }] }
      ]
    },
    // ... more rows
  ]
}
```

**Slack Block Kit Mapping:**

- Converts to `rich_text` blocks with `rich_text_table` elements
- `header_row` property identifies header cells
- `rows` array contains table data
- Supports text formatting within cells
- Column alignment preserved where possible

**Implementation Strategy:**

```typescript
function convertTableNode(node: Table): RichTextBlock {
  const tableElement: RichTextTable = {
    type: "rich_text_table",
    header_row: node.children[0].children.map((cell) =>
      convertTableCellContent(cell),
    ),
    rows: node.children
      .slice(1)
      .map((row) => row.children.map((cell) => convertTableCellContent(cell))),
  };

  return {
    type: "rich_text",
    elements: [tableElement],
  };
}
```

**Limitations:**

- Maximum 5 columns per table (Slack limitation)
- Complex nested content in cells may be flattened
- Very wide tables may be converted to code blocks as fallback

---

## MDAST Node Type Mappings

### Primary Node Processors

| MDAST Node Type | Handler Function         | Output Slack Block Type            |
| --------------- | ------------------------ | ---------------------------------- |
| `heading`       | `convertHeading()`       | `header` or `section`              |
| `paragraph`     | `convertParagraph()`     | `rich_text`                        |
| `list`          | `convertList()`          | `rich_text` with `rich_text_list`  |
| `listItem`      | `convertListItem()`      | `rich_text_section`                |
| `code`          | `convertCodeBlock()`     | `section` with mrkdwn              |
| `table`         | `convertTable()`         | `rich_text` with `rich_text_table` |
| `tableRow`      | `convertTableRow()`      | Array of cell content              |
| `tableCell`     | `convertTableCell()`     | `rich_text_section`                |
| `blockquote`    | `convertBlockquote()`    | `section` with mrkdwn              |
| `thematicBreak` | `convertThematicBreak()` | `divider`                          |
| `image`         | `convertImage()`         | `image`                            |
| `text`          | `convertText()`          | Text element                       |
| `strong`        | `convertStrong()`        | Text with `bold: true`             |
| `emphasis`      | `convertEmphasis()`      | Text with `italic: true`           |
| `inlineCode`    | `convertInlineCode()`    | Text with `code: true`             |
| `delete`        | `convertDelete()`        | Text with `strike: true`           |
| `link`          | `convertLink()`          | `rich_text_link`                   |

### Node Conversion Functions

#### Table Conversion (Primary Focus)

```typescript
interface TableConversionOptions {
  maxColumns: number;
  fallbackToCodeBlock: boolean;
  preserveAlignment: boolean;
}

function convertTable(
  node: Table,
  options: TableConversionOptions,
): SlackBlock[] {
  // Check if table fits Slack constraints
  if (node.children[0]?.children.length > options.maxColumns) {
    return convertTableToCodeBlock(node);
  }

  const headerRow = node.children[0];
  const dataRows = node.children.slice(1);

  const tableElement: RichTextTable = {
    type: "rich_text_table",
    header_row: headerRow.children.map((cell) =>
      processInlineContent(cell.children),
    ),
    rows: dataRows.map((row) =>
      row.children.map((cell) => processInlineContent(cell.children)),
    ),
  };

  return [
    {
      type: "rich_text",
      elements: [tableElement],
    },
  ];
}

function processInlineContent(nodes: MdastNode[]): RichTextElement[] {
  return nodes.map((node) => convertInlineNode(node)).flat();
}
```

#### Heading Conversion

```typescript
function convertHeading(node: Heading): SlackBlock {
  const text = extractTextContent(node.children);

  // Slack header blocks have 150 character limit
  if (node.depth <= 3 && text.length <= 150) {
    return {
      type: "header",
      text: {
        type: "plain_text",
        text: text,
      },
    };
  }

  // Fallback to section with formatting
  const headingSymbols = "#".repeat(node.depth);
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${headingSymbols} ${text}*`,
    },
  };
}
```

#### List Conversion with Checkbox Support

```typescript
function convertList(node: List): RichTextBlock {
  const listElement: RichTextList = {
    type: "rich_text_list",
    style: node.ordered ? "ordered" : "bullet",
    elements: node.children.map((item) => convertListItem(item, node)),
  };

  return {
    type: "rich_text",
    elements: [listElement],
  };
}

function convertListItem(node: ListItem, parentList: List): RichTextSection {
  const content = processInlineContent(node.children);

  // Handle checkbox lists (task lists)
  if (node.checked !== null) {
    const checkbox = node.checked ? "✅ " : "☐ ";
    content.unshift({
      type: "text",
      text: checkbox,
    });
  }

  return {
    type: "rich_text_section",
    elements: content,
  };
}
```

---

## Implementation Architecture

### Plugin File Structure

```
src/modules/entrypoints/modules/slack/
├── formatter.service.ts
├── plugins/
│   ├── remark-to-slack-blocks/
│   │   ├── index.ts                 # Main plugin export
│   │   ├── converters/
│   │   │   ├── table.converter.ts   # Table-specific logic
│   │   │   ├── list.converter.ts    # List and checkbox logic
│   │   │   ├── text.converter.ts    # Inline text formatting
│   │   │   └── block.converter.ts   # Block-level elements
│   │   ├── types/
│   │   │   ├── mdast.types.ts       # MDAST type definitions
│   │   │   └── slack.types.ts       # Slack Block Kit types
│   │   └── utils/
│   │       ├── text-extraction.ts   # Text content utilities
│   │       └── validation.ts        # Slack constraint validation
```

### Core Plugin Interface

```typescript
export interface SlackFormatterOptions {
  tables: {
    enabled: boolean;
    maxColumns: number;
    fallbackToCode: boolean;
    preserveAlignment: boolean;
  };
  checkboxes: {
    checkedSymbol: string;
    uncheckedSymbol: string;
  };
  limits: {
    maxHeaderLength: number;
    maxAltTextLength: number;
    maxBlocksPerMessage: number;
  };
  features: {
    autoLinkDetection: boolean;
    syntaxHighlighting: boolean;
  };
}

export interface ConversionContext {
  options: SlackFormatterOptions;
  blockCount: number;
  warnings: string[];
}
```

### Error Handling and Validation

```typescript
function validateSlackConstraints(blocks: SlackBlock[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check block count limit (50 blocks max)
  if (blocks.length > 50) {
    errors.push(`Too many blocks: ${blocks.length}/50`);
  }

  // Validate individual block constraints
  blocks.forEach((block, index) => {
    if (block.type === "header" && block.text.text.length > 150) {
      warnings.push(`Header at block ${index} exceeds 150 characters`);
    }

    if (block.type === "rich_text") {
      validateRichTextBlock(block, index, warnings);
    }
  });

  return { isValid: errors.length === 0, errors, warnings };
}
```

---

## Testing Strategy for Plugin

### Unit Test Categories

1. **MDAST Node Conversion Tests**

   ```typescript
   describe("Table Conversion", () => {
     it("should convert simple table to rich_text_table", () => {
       const mdastTable = createMockTableNode();
       const result = convertTable(mdastTable, defaultOptions);
       expect(result[0].type).toBe("rich_text");
       expect(result[0].elements[0].type).toBe("rich_text_table");
     });

     it("should fallback to code block for wide tables", () => {
       const wideTable = createMockWideTableNode(10); // 10 columns
       const result = convertTable(wideTable, { maxColumns: 5 });
       expect(result[0].type).toBe("section");
       expect(result[0].text.type).toBe("mrkdwn");
     });
   });
   ```

2. **Integration Tests**
   ```typescript
   describe('Full Pipeline', () => {
     it('should process markdown with tables correctly', async () => {
       const markdown = `
   ```

# Report

| Metric | Value |
| ------ | ----- |
| Users  | 1000  |

       `;

       const result = await slackFormatter.parse(markdown);
       expect(result).toHaveLength(2); // header + table
       expect(result[1].elements[0].type).toBe('rich_text_table');
     });

});

````

3. **Edge Case Tests**
- Empty tables
- Tables with formatting in cells
- Nested lists in table cells
- Mixed content documents

---

## Migration from @tryfabric/mack

### Migration Strategy

1. **Phase 1: Plugin Development**
- Implement core MDAST node converters
- Add comprehensive table support
- Maintain compatibility with existing API

2. **Phase 2: Feature Parity**
- Ensure all @tryfabric/mack features work
- Add enhanced table capabilities
- Implement thorough testing

3. **Phase 3: Replacement**
- Switch SlackFormatter to use custom plugin
- Remove @tryfabric/mack dependency
- Monitor performance and behavior

### Compatibility Layer

```typescript
export class SlackFormatter {
// Keep existing method for backward compatibility
public async parseWithFabricMack(message: string) {
 console.warn('parseWithFabricMack is deprecated, use parse() instead');
 return this.parse(message);
}

// New unified plugin implementation
public async parse(message: string) {
 const result = await this.pipeline().process(message);
 return result.data.slackBlocks;
}
}
````

---

## Future Enhancements

### Advanced Table Features

1. **Enhanced Cell Content**
   - Support for links within table cells
   - Inline formatting preservation
   - Multi-line cell content

2. **Table Styling**
   - Column width optimization
   - Row striping for readability
   - Header styling differentiation

3. **Large Table Handling**
   - Automatic table pagination
   - Scrollable table alternatives
   - Summary views for wide tables

### Plugin Extensions

1. **Custom Node Types**
   - Support for custom markdown extensions
   - Plugin ecosystem for specialized formatting
   - AI-specific formatting features

2. **Performance Optimizations**
   - AST caching for repeated content
   - Streaming processing for large documents
   - Memory-efficient node processing

---

_This specification serves as the foundation for implementing a robust,
table-capable markdown to Slack Block Kit converter using unified's plugin
architecture._
