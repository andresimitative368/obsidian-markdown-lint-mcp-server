# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian vault used as a **test-fixture set for a markdown-lint MCP server** (the server itself lives outside this repo). The notes deliberately contain lint and schema violations; the vault captures both the broken inputs and the expected, tool-processed outputs so the server's behavior can be exercised and regression-checked.

There is no build system, package manager, or test runner here. "Tests" are the fixture files themselves, validated by the external MCP server's tools.

## Layout and the original → snap-shot contract

- `original/` — input fixtures (`test-1..3.md`) with **intentional** lint errors, invalid front matter, and raw Mermaid blocks. Do not "fix" these; the errors are the point.
- `snap-shot/` — the **golden output**: what each `original/` note should look like after the MCP tools run. `snap-shot/attachments/<note>/` holds the SVGs rendered from that note's Mermaid blocks.
- `.schemas/` — JSON Schema (draft-07) front-matter contracts, one per note `type`.
- `.markdownlint.json` — the lint ruleset the server enforces.
- `.obsidian/` — Obsidian app config (not relevant to fixture logic).

When changing expected tool behavior, edit the `snap-shot/` files (and `attachments/`) to match; `diff original/<f> snap-shot/<f>` is the canonical way to see what a tool is expected to do. The three fixtures each target a different tool:

- **test-1** → `render_mermaid_diagrams`: each ` ```mermaid ` fence is replaced by `![label](attachments/test-1/<name>.svg)`, the SVG is written under `attachments/`, and `mermaid_svg_source: base64-embedded` is added to front matter.
- **test-2** → `lint_markdown` auto-fixes: `_em_`→`*em*`, `__strong__`→`**strong**`, bare URL→`<url>`, `*`/`+` list markers→`-`, trailing whitespace stripped, hard tabs→spaces, runs of blank lines collapsed.
- **test-3** → `validate_front_matter` repair: missing `author` added, invalid `category`/`status` mapped to allowed enum values, `tags` padded to the 4-item minimum.

## Front matter schemas (`.schemas/`)

The `type` field selects which schema validates a note (`article`, `brainstorming`, `deep-research`, `how-to`, `meeting`, `strategy`, `technical`). All schemas set `additionalProperties: false` — **unknown keys fail validation**.

Shared rules across every type:

- Required base set: `type, title, author, category, tags, description, summary, status, date_created, date_updated`.
- `category` — must be one of a fixed 30-value enum (e.g. `Software Development`, `Software Architecture`, `DevOps`; `Programming` is **not** valid — see test-3).
- `tags` — 4–12 items, each matching `^[a-z0-9][a-z0-9/_-]*$` (lowercase).
- `status` — `published | draft | in-progress` (`wip` is invalid).
- `version` — semver `x.y.z`; all dates — `YYYY-MM-DD`.

Type-specific required additions: `technical` adds `system, component`; `strategy` adds `version, related, prepared_for, quarter`; `meeting` adds `meeting_date, attendees`; `deep-research` adds `sources`.

The schemas are duplicated copies that share an identical `definitions` block (category, tags, status, semver, date, signoff, published). A change to any shared definition must be applied to **all seven** files.

## Markdown conventions (`.markdownlint.json`)

Match these when authoring or editing note bodies, since they are the rules the linter normalizes to:

- ATX headings (`#`), dash (`-`) list markers, asterisk emphasis/strong (`*`, `**`).
- 2-space nested-list indent; no trailing-space line breaks; at most 2 consecutive blank lines.
- Fenced code blocks with backticks; `---` for thematic breaks.
- Line-length (MD013) and duplicate-heading (MD024) rules are disabled.
