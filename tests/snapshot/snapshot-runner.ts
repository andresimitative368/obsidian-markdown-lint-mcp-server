/**
 * Snapshot harness for the obsidian-markdown-lint MCP server.
 *
 * Each fixture is an original/ (input) + snap-shot/ (expected output) pair under
 * test-obsidian-vault/. Running the input through the real MCP tools must
 * reproduce the snapshot:
 *
 *   test-1 — render_mermaid_diagrams: ```mermaid fences → image links + SVGs
 *   test-2 — lint_markdown: auto-fixable issues → fixed_content (lints clean)
 *   test-3 — validate_front_matter: invalid front matter → valid front matter
 *
 * Run with: npm run snapshot
 * Requires a real Chromium — test-1's render launches Puppeteer (no DI mock
 * here, unlike the evals). That is the point: it exercises the real path.
 *
 * SVG geometry is intentionally NOT byte-compared — it varies by mermaid /
 * Chromium / font version. The deterministic projection is compared instead:
 * the modified markdown, the file layout, and the embedded <mermaid:source>.
 *
 * Output: JSON { summary, checks } to stdout. Exit 1 if any check fails.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { lintMarkdown } from '../../src/tools/lint.js';
import { validateFrontMatter } from '../../src/tools/validate.js';
import { renderMermaidDiagrams, extractMermaidFromSvg } from '../../src/tools/mermaid.js';
import { extractMermaidSource } from '../../src/lib/svg-metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT = join(__dirname, '../../test-obsidian-vault');
const read = (p: string): string => readFileSync(join(VAULT, p), 'utf-8');

interface Check {
  name: string;
  passed: boolean;
  details: string;
}
const checks: Check[] = [];
const check = (name: string, passed: boolean, details = ''): void => {
  checks.push({ name, passed, details });
};

// Shared vault config + the document's schema (article).
const config = JSON.parse(read('.markdownlint.json')) as Record<string, unknown>;
const articleSchema = JSON.parse(read('.schemas/article.json')) as Record<string, unknown>;

// Input (un-embedded) and expected snapshot (embedded result).
const input = read('original/test-1.md');
const snapshotMd = read('snap-shot/test-1.md');
const snapFlow = read('attachments/snap-shot/test-1/flowchart-1.svg');
const snapSeq = read('attachments/snap-shot/test-1/sequence-1.svg');

// ════════════════════════════════════════════════════════════════════════════
// test-1 — render_mermaid_diagrams: original → snapshot
// ════════════════════════════════════════════════════════════════════════════
const rendered = await renderMermaidDiagrams(input, 'attachments', 'Test 1', 'default', 'white');

check('render: no errors', rendered.errors.length === 0, JSON.stringify(rendered.errors));

check(
  'render: modified_content matches snap-shot/test-1.md byte-for-byte',
  rendered.modified_content === snapshotMd,
  rendered.modified_content === snapshotMd ? '' : 'modified_content diverged from snapshot'
);

const paths = rendered.svgs.map((s) => s.path).join(',');
check(
  'render: svg filenames + paths match snapshot layout',
  paths === 'attachments/test-1/flowchart-1.svg,attachments/test-1/sequence-1.svg',
  paths
);

// Deterministic projection: compare the embedded mermaid source, not geometry.
const snapSources: Record<string, string | null> = {
  'flowchart-1.svg': extractMermaidSource(snapFlow),
  'sequence-1.svg': extractMermaidSource(snapSeq),
};
for (const s of rendered.svgs) {
  const fresh = extractMermaidSource(Buffer.from(s.data, 'base64').toString('utf-8'));
  check(
    `render: ${s.filename} embeds the same mermaid source as the snapshot`,
    fresh !== null && fresh === snapSources[s.filename],
    fresh === snapSources[s.filename] ? '' : 'embedded source differs from snapshot'
  );
}

// ── extract_mermaid_from_svg: snapshot SVGs → mermaid block ──────────────────
for (const [file, svg] of [
  ['flowchart-1.svg', snapFlow],
  ['sequence-1.svg', snapSeq],
] as const) {
  const ex = extractMermaidFromSvg(svg);
  const ok = !ex.error && !!ex.source && ex.mermaid_block === '```mermaid\n' + ex.source + '\n```';
  check(`extract: ${file} round-trips to a mermaid block`, ok, ex.error ?? '');
}

// ── validate_front_matter: snapshot front matter ────────────────────────────
const val = validateFrontMatter(snapshotMd, articleSchema);
check(
  'validate: snapshot front matter is valid against the article schema',
  val.valid,
  JSON.stringify(val.errors)
);

// ── lint_markdown: snapshot doc ─────────────────────────────────────────────
const lint = await lintMarkdown(snapshotMd, config);
const signature = lint.errors
  .map((e) => e.rule.split('/')[0] + '@' + e.line)
  .sort()
  .join(', ');
check(
  'lint: snapshot yields exactly the intended MD001 finding',
  signature === 'MD001@32',
  `findings: ${signature || '(none)'}`
);

// ════════════════════════════════════════════════════════════════════════════
// test-2 — lint_markdown corrects the markdown (no SVG)
// ════════════════════════════════════════════════════════════════════════════
const t2input = read('original/test-2.md');
const t2snapshot = read('snap-shot/test-2.md');
const t2orig = await lintMarkdown(t2input, config);
const t2clean = await lintMarkdown(t2snapshot, config);

check(
  'test-2: original has lint findings to correct',
  t2orig.errors.length > 0,
  `${t2orig.errors.length} finding(s): ${t2orig.errors.map((e) => e.rule.split('/')[0]).join(', ')}`
);
check(
  'test-2: fixed_content matches snap-shot/test-2.md byte-for-byte',
  t2orig.fixed_content === t2snapshot,
  t2orig.fixed_content === t2snapshot ? '' : 'fixed_content diverged from snapshot'
);
check(
  'test-2: snapshot lints clean (0 findings)',
  t2clean.errors.length === 0,
  t2clean.errors.map((e) => e.rule.split('/')[0] + '@' + e.line).join(', ')
);

// ════════════════════════════════════════════════════════════════════════════
// test-3 — validate_front_matter: broken front matter → fixed (no SVG)
// ════════════════════════════════════════════════════════════════════════════
const t3input = read('original/test-3.md');
const t3snapshot = read('snap-shot/test-3.md');
const t3orig = validateFrontMatter(t3input, articleSchema);
const t3fixed = validateFrontMatter(t3snapshot, articleSchema);

check(
  'test-3: original front matter is rejected by the article schema',
  !t3orig.valid && t3orig.errors.length > 0,
  t3orig.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
);
check(
  'test-3: snapshot front matter passes the article schema',
  t3fixed.valid,
  JSON.stringify(t3fixed.errors)
);

// ── report ───────────────────────────────────────────────────────────────────
const passed = checks.filter((c) => c.passed).length;
const failed = checks.length - passed;

console.log(JSON.stringify({ summary: { total: checks.length, passed, failed }, checks }, null, 2));

if (failed > 0) {
  process.exit(1);
}
