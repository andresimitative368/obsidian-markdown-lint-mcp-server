import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import { lintMarkdown } from './tools/lint.js';
import { validateFrontMatter } from './tools/validate.js';
import { renderMermaidDiagrams, extractMermaidFromSvg } from './tools/mermaid.js';

/**
 * Build the MCP server and register all tools. Pure construction — no transport,
 * no I/O, no side effects — so it can be unit-tested with an in-memory transport.
 * The stdio bootstrap lives in server.ts.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'obsidian-markdown-lint-mcp-server', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    'lint_markdown',
    {
      title: 'Lint Markdown',
      description:
        'Lint markdown content and return errors with a corrected version. ' +
        'Pass the contents of .markdownlint.json as config if available.',
      inputSchema: {
        content: z.string().describe('The markdown content to lint'),
        config: z
          .record(z.unknown())
          .optional()
          .describe('markdownlint configuration object (contents of .markdownlint.json)'),
      },
    },
    async ({ content, config }) => {
      const result = await lintMarkdown(content, config as Record<string, unknown> | undefined);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    'validate_front_matter',
    {
      title: 'Validate Front Matter',
      description:
        'Validate the YAML front matter of a markdown file against a JSON Schema. ' +
        'The schema should be read from .schemas/{type}.json where type is the value ' +
        'of the "type" field in the front matter.',
      inputSchema: {
        content: z.string().describe('The markdown content whose front matter to validate'),
        schema: z
          .record(z.unknown())
          .describe('JSON Schema object to validate the front matter against'),
      },
    },
    async ({ content, schema }) => {
      const result = validateFrontMatter(content, schema as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    'render_mermaid_diagrams',
    {
      title: 'Render Mermaid Diagrams',
      description:
        'Extract all mermaid code blocks from markdown content, render each to SVG, ' +
        'and return the modified markdown with GitHub-style image links replacing the ' +
        'code blocks. The Mermaid source is embedded base64-encoded in each SVG metadata element. ' +
        'Failed blocks are left unchanged. The front matter is updated with mermaid_svg_source: base64-embedded. ' +
        'SVGs are returned as base64-encoded data for the client to write to disk.',
      inputSchema: {
        content: z.string().describe('The markdown content containing mermaid code blocks'),
        attachments_dir: z
          .string()
          .describe('Relative path to the vault attachments directory (e.g. "attachments")'),
        document_title: z
          .string()
          .describe('Title of the document, used to create a subdirectory slug'),
        theme: z
          .enum(['default', 'dark', 'neutral', 'forest'])
          .optional()
          .describe('Mermaid theme (default: "default")'),
        background: z
          .string()
          .optional()
          .describe('Background color (default: "white", use "transparent" for no background)'),
      },
    },
    async ({ content, attachments_dir, document_title, theme, background }) => {
      const result = await renderMermaidDiagrams(
        content,
        attachments_dir,
        document_title,
        theme ?? 'default',
        background ?? 'white'
      );

      // Return everything in a single text payload. Each SVG's bytes are included
      // as base64 in `data` so Claude Code can decode and write the file to disk.
      //
      // We deliberately do NOT return MCP `image` content blocks here. The model
      // API only accepts raster image types (image/png, image/jpeg, image/gif,
      // image/webp); an `image/svg+xml` block makes the whole turn error out the
      // moment the result is sent to the model. SVG must travel as text.
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                modified_content: result.modified_content,
                svgs: result.svgs.map((s) => ({
                  filename: s.filename,
                  path: s.path,
                  data: s.data,
                })),
                errors: result.errors,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    'extract_mermaid_from_svg',
    {
      title: 'Extract Mermaid from SVG',
      description:
        'Extract the original Mermaid diagram source embedded in an SVG file created by ' +
        'render_mermaid_diagrams. Returns the raw source and a ready-to-use mermaid code block ' +
        'that can replace the image link in the markdown for editing. ' +
        'Pass the SVG file content as a string (read it from disk first).',
      inputSchema: {
        svg_content: z.string().describe('The full SVG file content as a string'),
      },
    },
    async ({ svg_content }) => {
      const result = extractMermaidFromSvg(svg_content);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
