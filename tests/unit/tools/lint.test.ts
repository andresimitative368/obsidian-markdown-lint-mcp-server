import { lintMarkdown } from '../../../src/tools/lint.js';

const CLEAN_MARKDOWN = `# Heading

Some paragraph text here.

## Second Heading

More content.
`;

const DIRTY_MARKDOWN = `# Heading

Some paragraph text here.

### Skipped Level Heading

Trailing spaces
More content.
`;

describe('lintMarkdown', () => {
  it('returns no errors for clean markdown', async () => {
    const result = await lintMarkdown(CLEAN_MARKDOWN);
    expect(result.errors).toHaveLength(0);
    expect(result.fixed_content).toBe(CLEAN_MARKDOWN);
  });

  it('returns errors for markdown with heading level skip', async () => {
    const result = await lintMarkdown(DIRTY_MARKDOWN);
    expect(result.errors.length).toBeGreaterThan(0);
    const ruleNames = result.errors.map((e) => e.rule);
    expect(ruleNames.some((r) => r.includes('MD001') || r.includes('heading-increment'))).toBe(true);
  });

  it('returns fixed_content as a string', async () => {
    const content = '# Heading\n\nText here.\n';
    const result = await lintMarkdown(content);
    expect(typeof result.fixed_content).toBe('string');
    expect(result.fixed_content.length).toBeGreaterThan(0);
  });

  it('respects custom config to disable rules', async () => {
    const withSkip = `# Heading\n\n### Jump Three Levels\n\nContent.\n`;
    const resultDefault = await lintMarkdown(withSkip);
    expect(resultDefault.errors.length).toBeGreaterThan(0);

    const resultCustom = await lintMarkdown(withSkip, { 'heading-increment': false });
    expect(resultCustom.errors).toHaveLength(0);
  });

  it('uses markdownlint defaults when no config provided', async () => {
    const content = '# Heading\n\nThis is fine.\n';
    const result = await lintMarkdown(content);
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('fixed_content');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('returns error objects with all expected fields', async () => {
    const content = `# Heading\n\n### Skip\n\nContent.\n`;
    const result = await lintMarkdown(content);
    expect(result.errors.length).toBeGreaterThan(0);
    const error = result.errors[0];
    expect(error).toHaveProperty('line');
    expect(error).toHaveProperty('rule');
    expect(error).toHaveProperty('description');
    expect(error).toHaveProperty('detail');
    expect(error).toHaveProperty('context');
    expect(typeof error.line).toBe('number');
  });
});
