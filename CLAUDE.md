# obsidian-markdown-lint-mcp-server

## Project overview

TypeScript **stdio** MCP server that lints markdown, validates front matter, and renders Mermaid diagrams to SVG. Claude Code launches it as a subprocess (`docker run -i --rm`) and talks JSON-RPC over stdin/stdout — no port, no long-running container. All tools are content-in/content-out — no volume mounts, no disk access. Claude Code owns all file I/O.

## Build and run

```bash
npm run build         # compile TypeScript → dist/
npm test              # Jest unit tests (52 tests, >90% coverage)
npm run test:coverage # tests + coverage report
docker build -t obsidian-markdown-lint-mcp .   # build the stdio server image (or: docker compose build)
```

## Running evals

**Trigger phrase:** When asked to "run evals", "evaluate the tools", "check tool quality", or "test tool correctness":

1. Run: `npm run eval`
2. Parse the JSON output from stdout
3. Report the summary and any failing evals
4. If any fail, investigate the failing tool function

The eval runner calls the compiled tool functions directly (no Docker required). Results are JSON with `summary.passed`, `summary.failed`, and a `results` array with per-eval details.

Example invocation:
```bash
npm run eval 2>&1 | head -50
```

## Snapshot harness

`npm run snapshot` proves that each un-embedded input reproduces its committed output through the **real** tool pipeline (test-1 launches Puppeteer, unlike the evals which mock rendering). Every fixture is an `original/` (input) + `snap-shot/` (expected output) pair under `test-obsidian-vault/`, with `.markdownlint.json` and `.schemas/` at the vault root shared by all:

- **test-1** — `render_mermaid_diagrams`: `original/test-1.md` has `` ```mermaid `` fences and no `mermaid_svg_source`; `snap-shot/test-1.md` + `attachments/snap-shot/test-1/*.svg` are the rendered result.
- **test-2** — `lint_markdown` (no SVG): `original/test-2.md` has auto-fixable lint issues (MD004/009/010/012/034/049/050); `snap-shot/test-2.md` is the tool's `fixed_content` and lints clean.
- **test-3** — `validate_front_matter` (no SVG): `original/test-3.md` has front matter that fails the article schema (missing `author`, bad `category`/`status` enums, too few `tags`); `snap-shot/test-3.md` is the corrected, valid version.

The harness (`tests/snapshot/snapshot-runner.ts`) runs each input through its tool and asserts the snapshot via **deterministic projection**: test-1 compares `modified_content` byte-for-byte, the SVG file layout, and the embedded `<mermaid:source>` (SVG *geometry* is not byte-compared — it varies by mermaid/Chromium/font version); test-2 compares `fixed_content` byte-for-byte and re-lints the snapshot to 0 findings; test-3 asserts the input is rejected and the snapshot validates. Output is JSON with `summary.passed`/`summary.failed`; exits non-zero on any failure. Requires a real Chromium, so it is kept out of `npm test`.

To regenerate `original/test-1.md` after editing its snapshot, reverse the transform: drop the `mermaid_svg_source` line and swap each image link back to its fence (sources live in the SVGs' `<mermaid:source>` metadata). To regenerate `snap-shot/test-2.md`, run `lint_markdown` on `original/test-2.md` and write the `fixed_content`.

## MCP server configuration

Register the server with Claude Code (it launches the container itself, per session):

```bash
claude mcp add obsidian-markdown-lint -s project -- docker run -i --rm obsidian-markdown-lint-mcp
```

This writes a `.mcp.json` with stdio config:
```json
{
  "mcpServers": {
    "obsidian-markdown-lint": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "obsidian-markdown-lint-mcp"]
    }
  }
}
```

The image must be built (`docker build -t obsidian-markdown-lint-mcp .`) and Docker Desktop running. Verify with `claude mcp list`; tools load at the start of a new Claude Code session. Do **not** use `docker compose up` — this is a stdio subprocess, not an HTTP service.

## Using the MCP tools

Prefer the MCP tools over reading source or running scripts directly.

**Trigger phrases and what to call:**

| User says | MCP tool to call |
|---|---|
| "lint this markdown", "check this file", "fix markdown" | `mcp__obsidian-markdown-lint__lint_markdown` |
| "validate front matter", "check the schema", "is this front matter valid" | `mcp__obsidian-markdown-lint__validate_front_matter` |
| "render mermaid", "convert diagrams to SVG" | `mcp__obsidian-markdown-lint__render_mermaid_diagrams` |
| "extract mermaid from SVG" | `mcp__obsidian-markdown-lint__extract_mermaid_from_svg` |

**Workflow for linting a file:**
1. Read the file with the `Read` tool
2. Pass the content to `mcp__obsidian-markdown-lint__lint_markdown`
3. If there are errors and the user wants fixes, write `fixed_content` back with the `Write` or `Edit` tool

**Workflow for validating front matter:**
1. Read the file with the `Read` tool
2. Identify the `type` field in the front matter to pick the right schema (see Schema files section)
3. Read the schema file from `.schemas/<type>.json`
4. Pass both to `mcp__obsidian-markdown-lint__validate_front_matter`

## Tool signatures (quick reference)

- `lint_markdown(content, config?)` → `{ errors[], fixed_content }`
- `validate_front_matter(content, schema)` → `{ valid, errors[] }`
- `render_mermaid_diagrams(content, attachments_dir, document_title, theme?, background?)` → `{ modified_content, svgs[], errors[] }`
- `extract_mermaid_from_svg(svg_content)` → `{ source, mermaid_block, error? }`

## Schema files

JSON Schema files live in `.schemas/`. Each maps to a `type` field value:
- `.schemas/article.json` — `type: article`
- `.schemas/how-to.json` — `type: how-to`
- `.schemas/technical.json` — `type: technical` (requires `system`, `component`)
- `.schemas/deep-research.json` — `type: deep-research` (requires `sources`)
- `.schemas/strategy.json` — `type: strategy` (requires `related`, `prepared_for`, `quarter`)
- `.schemas/meeting.json` — `type: meeting` (requires `meeting_date`, `attendees`)
- `.schemas/brainstorming.json` — `type: brainstorming`

## Testing conventions

- Unit tests: `tests/unit/**/*.test.ts`
- Eval fixtures: `tests/evals/fixtures/`
- Eval runner: `tests/evals/eval-runner.ts`
- `src/server.ts` (stdio bootstrap) and `src/create-server.ts` (tool registration) are excluded from coverage — pure wiring, exercised by `tests/unit/create-server.test.ts` via an in-memory transport

## Key technical notes

- ESM project (`"type": "module"` in package.json)
- `markdownlint` linting is via `markdownlint/promise` subpath; types/applyFixes from main `markdownlint`
- AJV uses named import `{ Ajv }` (not default import) due to NodeNext ESM resolution
- Zod uses `zod/v3` for MCP SDK compatibility
- `DEFAULT_BROWSER_FACTORY` and `DEFAULT_RENDERER` in mermaid.ts are istanbul-ignored (they wrap real Puppeteer/mermaid-cli; tests inject mocks via DI parameters)
