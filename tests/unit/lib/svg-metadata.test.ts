import { embedMermaidSource, extractMermaidSource } from '../../../src/lib/svg-metadata.js';

const MINIMAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>';

describe('embedMermaidSource', () => {
  it('inserts a metadata element after the opening svg tag', () => {
    const source = 'flowchart LR\n  A --> B';
    const result = embedMermaidSource(MINIMAL_SVG, source);
    expect(result).toContain('<metadata>');
    expect(result).toContain('mermaid:source');
    expect(result).toContain('encoding="base64"');
  });

  it('encodes the mermaid source as base64', () => {
    const source = 'flowchart LR\n  A --> B';
    const result = embedMermaidSource(MINIMAL_SVG, source);
    const encoded = Buffer.from(source).toString('base64');
    expect(result).toContain(encoded);
  });

  it('preserves the rest of the SVG content', () => {
    const source = 'pie title Test\n  A: 50';
    const result = embedMermaidSource(MINIMAL_SVG, source);
    expect(result).toContain('<rect width="100" height="100"/>');
    expect(result).toContain('</svg>');
  });

  it('handles mermaid source with special XML characters', () => {
    const source = 'flowchart LR\n  A["Label <tag>"] --> B & C';
    const result = embedMermaidSource(MINIMAL_SVG, source);
    const encoded = Buffer.from(source).toString('base64');
    expect(result).toContain(encoded);
  });

  it('handles mermaid source with whitespace-sensitive indentation', () => {
    const source = 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi';
    const result = embedMermaidSource(MINIMAL_SVG, source);
    const encoded = Buffer.from(source).toString('base64');
    expect(result).toContain(encoded);
  });
});

describe('extractMermaidSource', () => {
  it('extracts base64-encoded mermaid source from valid SVG', () => {
    const originalSource = 'flowchart LR\n  A --> B';
    const svgWithMeta = embedMermaidSource(MINIMAL_SVG, originalSource);
    const extracted = extractMermaidSource(svgWithMeta);
    expect(extracted).toBe(originalSource);
  });

  it('returns null for SVG with no embedded metadata', () => {
    const result = extractMermaidSource(MINIMAL_SVG);
    expect(result).toBeNull();
  });

  it('returns null for SVG with metadata but no mermaid:source element', () => {
    const svg = '<svg><metadata><other/></metadata><rect/></svg>';
    const result = extractMermaidSource(svg);
    expect(result).toBeNull();
  });

  it('returns null for completely empty input', () => {
    const result = extractMermaidSource('');
    expect(result).toBeNull();
  });

  it('round-trips whitespace-sensitive content faithfully', () => {
    const source = 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n    note right of Bob: done';
    const svgWithMeta = embedMermaidSource(MINIMAL_SVG, source);
    const extracted = extractMermaidSource(svgWithMeta);
    expect(extracted).toBe(source);
  });
});
