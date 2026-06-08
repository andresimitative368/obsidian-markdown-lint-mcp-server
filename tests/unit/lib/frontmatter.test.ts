import { parseFrontMatter, updateFrontMatter, getFrontMatterType } from '../../../src/lib/frontmatter.js';

describe('parseFrontMatter', () => {
  it('parses valid YAML front matter', () => {
    const content = `---\ntype: article\ntitle: Test\n---\n\n# Body`;
    const { data, body } = parseFrontMatter(content);
    expect(data.type).toBe('article');
    expect(data.title).toBe('Test');
    expect(body.trim()).toBe('# Body');
  });

  it('returns empty data when no front matter present', () => {
    const content = '# Just a heading\nNo front matter here.';
    const { data, body } = parseFrontMatter(content);
    expect(data).toEqual({});
    expect(body.trim()).toBe('# Just a heading\nNo front matter here.');
  });

  it('parses front matter with arrays', () => {
    const content = `---\ntags:\n  - one\n  - two\n---\nbody`;
    const { data } = parseFrontMatter(content);
    expect(data.tags).toEqual(['one', 'two']);
  });

  it('parses front matter with nested objects', () => {
    const content = `---\nsignoff:\n  - name: Alice\n    date: 2026-01-01\n---\nbody`;
    const { data } = parseFrontMatter(content);
    expect(Array.isArray(data.signoff)).toBe(true);
  });
});

describe('updateFrontMatter', () => {
  it('adds a new field to existing front matter', () => {
    const content = `---\ntype: article\n---\nbody`;
    const updated = updateFrontMatter(content, { status: 'draft' });
    expect(updated).toContain('status: draft');
    expect(updated).toContain('type: article');
  });

  it('updates an existing field', () => {
    const content = `---\nstatus: draft\n---\nbody`;
    const updated = updateFrontMatter(content, { status: 'published' });
    expect(updated).toContain('status: published');
    expect(updated).not.toContain('status: draft');
  });

  it('adds mermaid_svg_source field', () => {
    const content = `---\ntype: article\n---\nbody`;
    const updated = updateFrontMatter(content, { mermaid_svg_source: 'base64-embedded' });
    expect(updated).toContain('mermaid_svg_source: base64-embedded');
  });

  it('preserves body content', () => {
    const content = `---\ntype: article\n---\n\n## My Heading\n\nSome content.`;
    const updated = updateFrontMatter(content, { status: 'published' });
    expect(updated).toContain('## My Heading');
    expect(updated).toContain('Some content.');
  });
});

describe('getFrontMatterType', () => {
  it('returns the type field value', () => {
    const content = `---\ntype: meeting\n---\nbody`;
    expect(getFrontMatterType(content)).toBe('meeting');
  });

  it('returns undefined when type field is absent', () => {
    const content = `---\ntitle: No Type\n---\nbody`;
    expect(getFrontMatterType(content)).toBeUndefined();
  });

  it('returns undefined when there is no front matter', () => {
    const content = '# Just a heading';
    expect(getFrontMatterType(content)).toBeUndefined();
  });
});
