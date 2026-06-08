/**
 * Eval runner for obsidian-markdown-lint-mcp-server tools.
 *
 * Run with: npm run eval
 * Output: JSON array of eval results to stdout.
 *
 * Each eval has: name, tool, passed, details
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { lintMarkdown } from '../../src/tools/lint.js';
import { validateFrontMatter } from '../../src/tools/validate.js';
import { extractMermaidFromSvg, renderMermaidDiagrams } from '../../src/tools/mermaid.js';
import { embedMermaidSource } from '../../src/lib/svg-metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const SCHEMAS = join(__dirname, '../../.schemas');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS, `${name}.json`), 'utf-8')) as Record<string, unknown>;
}

interface EvalResult {
  name: string;
  tool: string;
  passed: boolean;
  details: string;
}

const results: EvalResult[] = [];

function pass(name: string, tool: string, details: string): void {
  results.push({ name, tool, passed: true, details });
}

function fail(name: string, tool: string, details: string): void {
  results.push({ name, tool, passed: false, details });
}

// ─── lint_markdown evals ────────────────────────────────────────────────────

{
  const name = 'lint: detects heading-level skip';
  try {
    const content = fixture('lint-errors.md');
    const result = await lintMarkdown(content);
    if (result.errors.length > 0 && result.errors.some((e) => e.rule.includes('MD001') || e.rule.includes('heading-increment'))) {
      pass(name, 'lint_markdown', `Found ${result.errors.length} error(s), heading-increment present`);
    } else {
      fail(name, 'lint_markdown', `Expected heading-increment error, got: ${JSON.stringify(result.errors.map(e => e.rule))}`);
    }
  } catch (e) {
    fail(name, 'lint_markdown', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'lint: clean content returns no errors';
  try {
    const content = fixture('clean-markdown.md');
    const result = await lintMarkdown(content);
    if (result.errors.length === 0) {
      pass(name, 'lint_markdown', 'No lint errors on valid article');
    } else {
      fail(name, 'lint_markdown', `Expected 0 errors, got ${result.errors.length}: ${result.errors.map(e => `${e.rule}@L${e.line}`).join(', ')}`);
    }
  } catch (e) {
    fail(name, 'lint_markdown', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'lint: returns fixed_content with same or fewer errors';
  try {
    const content = fixture('lint-errors.md');
    const result = await lintMarkdown(content);
    const recheck = await lintMarkdown(result.fixed_content);
    if (recheck.errors.length <= result.errors.length) {
      pass(name, 'lint_markdown', `Errors: before=${result.errors.length} after=${recheck.errors.length}`);
    } else {
      fail(name, 'lint_markdown', `fixed_content has MORE errors: ${recheck.errors.length} vs ${result.errors.length}`);
    }
  } catch (e) {
    fail(name, 'lint_markdown', `Threw: ${(e as Error).message}`);
  }
}

// ─── validate_front_matter evals ────────────────────────────────────────────

{
  const name = 'validate: valid article passes';
  try {
    const content = fixture('valid-article.md');
    const articleSchema = schema('article');
    const result = validateFrontMatter(content, articleSchema);
    if (result.valid) {
      pass(name, 'validate_front_matter', 'Article passed validation');
    } else {
      fail(name, 'validate_front_matter', `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
    }
  } catch (e) {
    fail(name, 'validate_front_matter', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'validate: meeting without attendees fails';
  try {
    const content = fixture('invalid-meeting.md');
    const meetingSchema = schema('meeting');
    const result = validateFrontMatter(content, meetingSchema);
    if (!result.valid && result.errors.some((e) => e.message.includes('required'))) {
      pass(name, 'validate_front_matter', `Correctly rejected: ${JSON.stringify(result.errors.map(e => e.message))}`);
    } else {
      fail(name, 'validate_front_matter', `Expected invalid with required error. Got valid=${result.valid}, errors=${JSON.stringify(result.errors)}`);
    }
  } catch (e) {
    fail(name, 'validate_front_matter', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'validate: technical doc passes with system + component';
  try {
    const content = fixture('mermaid-document.md');
    const technicalSchema = schema('technical');
    const result = validateFrontMatter(content, technicalSchema);
    if (result.valid) {
      pass(name, 'validate_front_matter', 'Technical doc with system+component passed validation');
    } else {
      fail(name, 'validate_front_matter', `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
    }
  } catch (e) {
    fail(name, 'validate_front_matter', `Threw: ${(e as Error).message}`);
  }
}

// ─── render_mermaid_diagrams evals (DI — no real browser needed) ─────────────

const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

{
  const name = 'render: no mermaid blocks returns unchanged content';
  try {
    const content = fixture('valid-article.md');
    const result = await renderMermaidDiagrams(content, 'attachments', 'Test Doc');
    if (result.modified_content === content && result.svgs.length === 0) {
      pass(name, 'render_mermaid_diagrams', 'Returned unchanged content and empty svgs array');
    } else {
      fail(name, 'render_mermaid_diagrams', 'Content was modified or SVGs were added unexpectedly');
    }
  } catch (e) {
    fail(name, 'render_mermaid_diagrams', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'render: replaces mermaid block with image link';
  try {
    const content = fixture('mermaid-document.md');
    const mockBrowser = { close: async () => undefined } as never;
    const mockFactory = async () => mockBrowser;
    const mockRenderer = async () => ({
      title: null,
      desc: null,
      data: Buffer.from(FAKE_SVG) as unknown as Uint8Array,
    });
    const result = await renderMermaidDiagrams(
      content, 'attachments', 'System Architecture Overview',
      'default', 'white', mockFactory, mockRenderer
    );
    const hasImageLinks = result.modified_content.includes('![') && result.modified_content.includes('.svg)');
    const noMermaidFences = !result.modified_content.includes('```mermaid');
    if (hasImageLinks && noMermaidFences && result.svgs.length === 2) {
      pass(name, 'render_mermaid_diagrams', `Rendered ${result.svgs.length} SVG(s), replaced all mermaid blocks`);
    } else {
      fail(name, 'render_mermaid_diagrams', `hasImageLinks=${hasImageLinks} noMermaidFences=${noMermaidFences} svgs=${result.svgs.length}`);
    }
  } catch (e) {
    fail(name, 'render_mermaid_diagrams', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'render: embeds mermaid source as base64 in SVG metadata';
  try {
    const source = 'flowchart LR\n  A --> B\n';
    const content = `# Test\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
    const mockBrowser = { close: async () => undefined } as never;
    const mockFactory = async () => mockBrowser;
    const mockRenderer = async () => ({
      title: null,
      desc: null,
      data: Buffer.from(FAKE_SVG) as unknown as Uint8Array,
    });
    const result = await renderMermaidDiagrams(
      content, 'attachments', 'Test',
      'default', 'white', mockFactory, mockRenderer
    );
    const svgDecoded = Buffer.from(result.svgs[0].data, 'base64').toString('utf-8');
    const hasMetadata = svgDecoded.includes('mermaid:source') && svgDecoded.includes('encoding="base64"');
    if (hasMetadata) {
      pass(name, 'render_mermaid_diagrams', 'SVG contains base64-encoded mermaid:source metadata');
    } else {
      fail(name, 'render_mermaid_diagrams', 'SVG missing mermaid:source metadata element');
    }
  } catch (e) {
    fail(name, 'render_mermaid_diagrams', `Threw: ${(e as Error).message}`);
  }
}

// ─── extract_mermaid_from_svg evals ─────────────────────────────────────────

{
  const name = 'extract: round-trips mermaid source faithfully';
  try {
    const originalSource = 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi there';
    const svgWithMeta = embedMermaidSource(FAKE_SVG, originalSource);
    const result = extractMermaidFromSvg(svgWithMeta);
    if (result.source === originalSource && result.mermaid_block?.includes('```mermaid')) {
      pass(name, 'extract_mermaid_from_svg', 'Source extracted exactly, code block formatted correctly');
    } else {
      fail(name, 'extract_mermaid_from_svg', `source match=${result.source === originalSource} block=${result.mermaid_block}`);
    }
  } catch (e) {
    fail(name, 'extract_mermaid_from_svg', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'extract: reports error for SVG without embedded source';
  try {
    const result = extractMermaidFromSvg(FAKE_SVG);
    if (!result.source && result.error) {
      pass(name, 'extract_mermaid_from_svg', `Correctly returned error: "${result.error}"`);
    } else {
      fail(name, 'extract_mermaid_from_svg', `Expected null source + error, got: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    fail(name, 'extract_mermaid_from_svg', `Threw: ${(e as Error).message}`);
  }
}

{
  const name = 'extract: preserves whitespace-sensitive indentation';
  try {
    const source = 'sequenceDiagram\n    Alice->>Bob: Hello\n    note right of Bob: important\n    Bob-->>Alice: done';
    const svgWithMeta = embedMermaidSource(FAKE_SVG, source);
    const result = extractMermaidFromSvg(svgWithMeta);
    if (result.source === source) {
      pass(name, 'extract_mermaid_from_svg', 'Whitespace preserved exactly through base64 round-trip');
    } else {
      fail(name, 'extract_mermaid_from_svg', `Whitespace mismatch. Expected:\n${source}\n\nGot:\n${result.source}`);
    }
  } catch (e) {
    fail(name, 'extract_mermaid_from_svg', `Threw: ${(e as Error).message}`);
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log(JSON.stringify({ summary: { total: results.length, passed, failed }, results }, null, 2));

if (failed > 0) {
  process.exit(1);
}
