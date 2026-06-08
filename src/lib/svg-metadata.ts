const MERMAID_NS = 'http://mermaid.js.org/';

export function embedMermaidSource(svgContent: string, mermaidSource: string): string {
  const encoded = Buffer.from(mermaidSource).toString('base64');
  const metadataBlock = `<metadata>
  <mermaid:source xmlns:mermaid="${MERMAID_NS}" encoding="base64">${encoded}</mermaid:source>
</metadata>`;

  // Insert metadata block immediately after the opening <svg ...> tag
  return svgContent.replace(/(<svg[^>]*>)/, `$1\n${metadataBlock}`);
}

export function extractMermaidSource(svgContent: string): string | null {
  const match = svgContent.match(
    /<mermaid:source[^>]*encoding="base64"[^>]*>([^<]+)<\/mermaid:source>/
  );
  if (!match) return null;
  try {
    return Buffer.from(match[1].trim(), 'base64').toString('utf-8');
  } catch {
    return null;
  }
}
