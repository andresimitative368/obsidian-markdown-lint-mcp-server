# Product Requirements Document: obsidian-markdown-lint-mcp-server

**Codename:** cuddly-coral
**Author:** Philip A Senger
**Status:** In Development
**Version:** 0.1.0

---

## Problem

Obsidian vault markdown files need consistent quality enforcement: lint rules, typed front matter schemas, and rendered diagrams. Doing this manually is error-prone and tedious. Doing it via a locally-installed Node.js toolchain exposes the laptop to supply-chain risk from dozens of transitive dependencies and a Chromium browser process.

---

## Solution

A Model Context Protocol (MCP) server packaged in Docker that Claude Code can call as a tool. The server processes markdown content sent as strings and returns results — it never mounts the vault filesystem. Docker provides full isolation; Claude Code owns all disk I/O.

---

## Personas

**Primary user:** Philip A Senger, using Claude Code as an AI assistant within Obsidian vault projects. Technical background in both Node.js and Python. Security-conscious about what runs on the host machine.

---

## Scope

### In scope (v0.1.0)

- Markdown linting via `markdownlint`
- Front matter validation against user-supplied JSON Schema (7 note types)
- Mermaid diagram rendering to SVG with base64-embedded source in `<metadata>`
- SVG-to-Mermaid extraction for round-trip editing
- Docker packaging with HTTP/SSE MCP transport
- Claude Code as the sole supported MCP client

### Out of scope

- Volume-mounted vault access
- Batch file processing
- CI/CD integration
- Non-Obsidian markdown flavours (e.g. GitHub wiki, Confluence)
- PDF or PNG output from Mermaid

---

## Architecture

### Transport

**HTTP/SSE (StreamableHTTP) on port 3000.** Docker makes stdio transport impractical; HTTP is the natural choice for a containerized long-running server.

### Runtime

**Node.js 20 + TypeScript.** Required by `@mermaid-js/mermaid-cli` (ESM-only), `markdownlint` (ESM-only), and `@modelcontextprotocol/sdk`.

### Isolation model

The server is **stateless and content-based**. No Docker volume mounts. Tools accept markdown/SVG content as strings and return structured results. Claude Code reads vault files, calls tools, and writes outputs back to disk. This keeps the container isolated from the host filesystem.

### Docker base image

`ghcr.io/puppeteer/puppeteer:22` — ships Chromium pre-installed. Mermaid rendering requires a real browser (JSDOM is unreliable for all diagram types). Chromium RAM usage is ~100-200MB only during active rendering; baseline server RAM is ~50-100MB.

---

## MCP Tools

### `lint_markdown`

```
Input:
  content: string          — markdown to lint
  config?: object          — markdownlint config (contents of .markdownlint.json)

Output:
  errors: Array<{ line, rule, description, detail, context }>
  fixed_content: string    — auto-fixed version of the input
```

- Config is optional; defaults to `markdownlint` default ruleset if omitted.
- Config file lives at `{vault}/.markdownlint.json`; Claude reads and passes it.

### `validate_front_matter`

```
Input:
  content: string          — markdown with YAML front matter
  schema: object           — JSON Schema to validate against

Output:
  valid: boolean
  errors: Array<{ path, message }>
```

- Schema is a full JSON Schema document, not just a type name.
- Client determines which schema to load based on the `type` field in front matter.
- Seven schemas ship in `.schemas/`: `article`, `how-to`, `technical`, `deep-research`, `strategy`, `meeting`, `brainstorming`.

### `render_mermaid_diagrams`

```
Input:
  content: string          — markdown containing one or more ```mermaid blocks
  attachments_dir: string  — relative vault path, e.g. "attachments"
  document_title: string   — used to create subdirectory slug
  theme?: string           — default | dark | neutral | forest  (default: "default")
  background?: string      — CSS color or "transparent"         (default: "white")

Output (multi-content):
  text: {
    modified_content: string   — markdown with code blocks replaced by image links
    svgs: Array<{ filename, path }>
    errors: Array<{ block_index, source, error }>
  }
  image[]: base64 SVG data for each successfully rendered diagram
```

**Behaviour:**
- All ` ```mermaid ``` ` blocks in the file are processed in order.
- Failed blocks are left unchanged in `modified_content`; their error is reported in `errors`.
- Code blocks are replaced with GitHub-style `![description](path/to/file.svg)`.
- SVG path: `{attachments_dir}/{document-title-slug}/{diagram-type}-{n}.svg`
- After rendering, front matter gains `mermaid_svg_source: base64-embedded`.
- Each SVG contains the original Mermaid source base64-encoded in `<metadata>`:

```xml
<metadata>
  <mermaid:source xmlns:mermaid="http://mermaid.js.org/" encoding="base64">
    {base64}
  </mermaid:source>
</metadata>
```

Base64 is used rather than raw text or XML CDATA because Mermaid is whitespace-sensitive and XML attribute/text normalization would silently corrupt indentation.

### `extract_mermaid_from_svg`

```
Input:
  svg_content: string      — full SVG file content

Output:
  source: string | null    — original Mermaid diagram source
  mermaid_block: string | null — ready-to-paste ```mermaid block
  error?: string           — present if no embedded source found
```

Enables round-trip editing: render → view in Obsidian → extract → modify → re-render.

---

## Front Matter Schemas

### Discriminator

The `type` field in front matter selects the schema. Claude reads `type`, loads `.schemas/{type}.json`, and passes it to `validate_front_matter`.

### Core fields (all types)

| Field | Type | Constraint |
|---|---|---|
| `type` | enum | One of 7 type values |
| `title` | string | Non-empty |
| `author` | string | Non-empty |
| `category` | enum | One of 30 defined categories |
| `tags` | string[] | 4–12 items, lowercase-hyphenated |
| `description` | string | One sentence |
| `summary` | string | 2–3 sentences |
| `status` | enum | `published` \| `draft` \| `in-progress` |
| `version` | string | Semver `X.Y.Z` |
| `date_created` | string | `YYYY-MM-DD` |
| `date_updated` | string | `YYYY-MM-DD` |

### Type-specific required fields

| Type | Additional required |
|---|---|
| `technical` | `system`, `component` |
| `deep-research` | `sources` (array, min 1) |
| `strategy` | `related`, `prepared_for`, `quarter` |
| `meeting` | `meeting_date`, `attendees` (array, min 1) |

### Schema delivery

Schemas are passed as tool arguments per call (Option A). This keeps the server stateless and allows schema updates without restarting Docker. Schemas reside in the vault at `.schemas/{type}.json`.

---

## Configuration

### Vault configuration files

| File | Purpose |
|---|---|
| `.markdownlint.json` | Linting rules passed to `lint_markdown` |
| `.schemas/{type}.json` | JSON Schema per note type passed to `validate_front_matter` |

### CLAUDE.md vault instructions

The vault project's `CLAUDE.md` instructs Claude Code when and how to chain the tools — e.g. "when asked to process a file, call lint, validate, and render in sequence". This is the client-side orchestration layer; the server has no knowledge of it.

### Claude Code MCP config

```json
{
  "mcpServers": {
    "obsidian-markdown-lint": {
      "url": "http://localhost:3000"
    }
  }
}
```

---

## Non-functional Requirements

| Requirement | Target |
|---|---|
| Baseline container RAM | ≤ 150MB idle |
| Chromium RAM during render | ≤ 300MB (process exits after render) |
| Docker image size | ~800MB on disk (Puppeteer base image) |
| Startup time | ≤ 5 seconds |
| Mermaid render latency | ≤ 10 seconds per diagram |
| Security | No volume mounts; container runs as non-root (`pptruser`) |

---

## Decisions Log

| Decision | Rationale |
|---|---|
| HTTP/SSE over stdio | Docker makes stdio impractical |
| Node.js over Python | mermaid-cli, markdownlint, MCP SDK are Node-native |
| Content-in/content-out | Avoids volume mounts; preserves container isolation |
| `@mermaid-js/mermaid-cli` (Puppeteer) over JSDOM | JSDOM is unreliable for complex diagram types |
| Base64 in `<metadata>` over CDATA/attributes | Whitespace-safe; XML attribute normalization corrupts Mermaid source |
| Schemas as tool arguments | Stateless server; schemas can be updated without restart |
| GitHub-style `![](path.svg)` over Obsidian `![[]]` | Portable; renders in GitHub, standard viewers, and Obsidian |
| Stateless server per request | Simplest deployment model; no session management needed |

---

## Verification Checklist

- [ ] `docker compose up --build` — server logs "listening on port 3000"
- [ ] `lint_markdown` with deliberate errors returns populated `errors` array and corrected `fixed_content`
- [ ] `validate_front_matter` with a `meeting` file missing `attendees` returns `valid: false`
- [ ] `render_mermaid_diagrams` with a `flowchart LR` block returns SVG image content, updated markdown, `mermaid_svg_source` in front matter
- [ ] Decode base64 from SVG `<metadata>` — matches original Mermaid source exactly
- [ ] `render_mermaid_diagrams` with a broken Mermaid block — original block preserved, error in `errors`
- [ ] `extract_mermaid_from_svg` on a rendered SVG returns the original source as a ` ```mermaid ``` ` block
