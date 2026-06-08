# How to Build an MCP Server in Docker and Wire It Into Claude Code

> A blueprint with real references, embedded examples, and a step-by-step guide — plus a diagnosis of why *this* codebase keeps failing.

This document was assembled from a multi-source, fact-checked research pass against the official MCP specification, the official Claude Code docs, and the official Docker MCP Toolkit docs. Every load-bearing claim is cited inline; full source list is at the bottom.

---

## TL;DR — the one thing you got wrong

**Claude Code launches a local MCP server as a subprocess and talks to it over `stdin`/`stdout` (the "stdio" transport). Your server is built as an HTTP server on port 3000 and started with `docker compose up`. Those two models are incompatible.**

For Docker + Claude Code, the correct shape is:

```bash
# Build the image once
docker build -t obsidian-markdown-lint-mcp .

# Register it — Claude Code will run `docker run -i --rm ...` itself, per session
claude mcp add obsidian-markdown-lint -- docker run -i --rm obsidian-markdown-lint-mcp
```

There is **no long-running container**, **no port 3000**, **no `docker compose up`**, and **no `url`** in the config. Claude Code starts the container when a session opens and kills it when the session ends. The `-i` flag is mandatory; without it the container's stdin closes immediately and the server exits. [S1][S15][S22]

If you want a long-running HTTP server instead, that's a *different* (valid) path covered in [Appendix A](#appendix-a-the-http-streamable-http-alternative). Pick one. The current code tries to auto-detect both at runtime and gets it wrong.

---

## Table of contents

1. [Background: MCP transports (and which one Claude Code uses)](#1-background-mcp-transports)
2. [What is wrong with this codebase, specifically](#2-what-is-wrong-with-this-codebase-specifically)
3. [The blueprint: canonical stdio-in-Docker server](#3-the-blueprint-canonical-stdio-in-docker-server)
4. [Step-by-step: build it and wire it into Claude Code](#4-step-by-step-build-and-wire-it-in)
5. [Docker Desktop "MCP Toolkit" (beta) — the other path](#5-docker-desktop-mcp-toolkit-beta)
6. [Failure modes & debugging checklist](#6-failure-modes--debugging-checklist)
7. [Appendix A: the HTTP / Streamable HTTP alternative](#appendix-a-the-http-streamable-http-alternative)
8. [Reference templates & sources](#reference-templates--sources)

---

## 1. Background: MCP transports

The current MCP spec (revision 2025-06-18) defines **exactly two** standard transports: **stdio** and **Streamable HTTP**. The old **HTTP+SSE** transport was *replaced* by Streamable HTTP in the 2025-03-26 spec revision and is now deprecated. [S6][S7]

| Transport | How it works | When to use | Claude Code flag |
|---|---|---|---|
| **stdio** | Client **launches the server as a subprocess** and exchanges newline-delimited JSON-RPC over the process's `stdin`/`stdout`. | **Local servers, including anything you run in Docker on your own machine.** This is what you want. | default (or `--transport stdio`) [S1] |
| **Streamable HTTP** | A long-running server exposes a **single `/mcp` endpoint**; client POSTs JSON-RPC and optionally GETs an SSE stream. | Remote / shared servers, multiple clients. | `--transport http` [S1] |
| **SSE** (HTTP+SSE) | Two-endpoint legacy design. | **Deprecated. Don't.** | `--transport sse` (deprecated) [S1] |

Key spec rules for stdio (these are the rules your server must obey):

- "The server reads JSON-RPC messages from its standard input (`stdin`) and sends messages to its standard output (`stdout`). Messages are delimited by newlines, and **MUST NOT** contain embedded newlines." [S6]
- "The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message." [S6]
- "The server **MAY** write UTF-8 strings to its standard error (`stderr`) for logging purposes." [S6]

> **The single most common reason an MCP server "fails for no reason": it printed something to `stdout`.** A stray `console.log`, a banner, a library log line — any non-JSON-RPC byte on stdout corrupts the stream and the client disconnects. All logging goes to **stderr** (`console.error`). [S2][S8][S9][S14]

**Why `docker run -i` and what Claude Code actually does:** because stdio is a subprocess model, Claude Code runs your command itself. When that command is `docker run -i --rm <image>`, Docker keeps stdin open (`-i`) so the JSON-RPC stream flows, and removes the container on exit (`--rm`). Omit `-i` and "the container's stdin closes immediately… the server gets an immediate EOF and exits." [S15][S22] This is exactly the canonical pattern the official GitHub MCP server uses. [S3]

---

## 2. What is wrong with this codebase, specifically

I read your `src/server.ts`, `Dockerfile`, `docker-compose.yml`, `README.md`, and `CLAUDE.md`. Here are the concrete defects, in priority order.

### 2.1 The transport is chosen by TTY detection — and it's backwards for Docker

`src/server.ts:166`:

```ts
if (!process.stdin.isTTY) {
  // stdio mode — Claude Code runs this via `docker run -i`
  ...
} else {
  // HTTP mode — `docker compose up` or local `node dist/server.js`
  ...
}
```

This is the root cause. TTY presence does **not** reliably distinguish "Claude Code spawned me" from "compose started me":

- `docker compose up` (no TTY) → `!isTTY` is `true` → enters **stdio mode**, reads EOF on an empty stdin, and **exits immediately**. With `restart: unless-stopped` in your compose file, it **crash-loops forever and never listens on port 3000** — even though `CLAUDE.md` and `README.md` both claim `docker compose up` "starts the MCP server on port 3000." It does not.
- This exact class of bug — stdin-not-a-TTY under compose vs. plain `docker run -i` — is a known, documented Docker behavior difference. [S5]

**Fix:** delete the auto-detection. Choose the transport explicitly via an env var (default `stdio`), as the well-regarded TS starter template does (`STARTER_TRANSPORT=stdio|http`). [S12]

### 2.2 The README's Claude Code config cannot work

`README.md` tells users to put this in `.claude/settings.json`:

```json
{ "mcpServers": { "obsidian-markdown-lint": { "url": "http://localhost:3000" } } }
```

Three independent problems:

1. **Wrong transport for the recommended run command.** A `url` field means HTTP transport, but the recommended `docker compose up` never serves HTTP (see 2.1).
2. **Wrong endpoint even if it did.** Your HTTP handlers live at `/mcp` (`server.ts:177,199`), not `/`. A bare `http://localhost:3000` would 404.
3. **Wrong file / wrong mechanism.** Claude Code reads MCP servers from **`.mcp.json`** (project scope) or **`~/.claude.json`** (user scope), normally written by `claude mcp add`. `.claude/settings.json` is not where Claude Code looks for `mcpServers`. (That `mcpServers`-with-`url` shape is closer to **Claude *Desktop***'s `claude_desktop_config.json`, a different product.) [S1][S11]

### 2.3 Three transports are imported but only one is needed

`server.ts:1-5` imports `StreamableHTTPServerTransport`, `SSEServerTransport`, `StdioServerTransport`, **and** `createMcpExpressApp`. (For the record: these imports are *valid* in SDK 1.29.0 — I verified `createMcpExpressApp` really is exported from `@modelcontextprotocol/sdk/server/express.js`. So your failures are **not** a bad-import problem, contrary to what you might assume.) The problem is architectural sprawl, not a missing module. A stdio server needs only `StdioServerTransport`. The SSE transport is deprecated anyway. [S1][S10]

### 2.4 Risk: logging to stdout

You currently `console.log(...)` only in the HTTP branch (`server.ts:228,232,...`), so stdio mode is *probably* clean today. But the Mermaid/Puppeteer path and `@mermaid-js/mermaid-cli` can emit progress/banners. **Audit every dependency for stdout chatter** before trusting stdio mode. One stray line = silent disconnect. [S2][S8][S9]

### 2.5 Summary

Your code isn't "broken" at the syntax level — it builds and the imports resolve. It's **architecturally confused**: it documents an HTTP+compose workflow, ships a runtime that silently flips to stdio under compose, and hands Claude Code a config that points at an HTTP URL that never comes up. The fix is to **commit to stdio** and delete the rest.

---

## 3. The blueprint: canonical stdio-in-Docker server

This is the target shape. It is deliberately minimal.

### 3.1 `src/server.ts` (stdio only)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import { lintMarkdown } from './tools/lint.js';
import { validateFrontMatter } from './tools/validate.js';
import { renderMermaidDiagrams, extractMermaidFromSvg } from './tools/mermaid.js';

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'obsidian-markdown-lint-mcp-server', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    'lint_markdown',
    {
      title: 'Lint Markdown',
      description: 'Lint markdown content and return errors with a corrected version.',
      inputSchema: {
        content: z.string().describe('The markdown content to lint'),
        config: z.record(z.unknown()).optional()
          .describe('markdownlint configuration object'),
      },
    },
    async ({ content, config }) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify(lintMarkdown(content, config as Record<string, unknown> | undefined), null, 2),
      }],
    })
  );

  // ... register validate_front_matter, render_mermaid_diagrams, extract_mermaid_from_svg
  //     exactly as you do today (those tool bodies are fine) ...

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // CRITICAL: stderr, never stdout. stdout is the JSON-RPC channel.
  console.error('obsidian-markdown-lint-mcp-server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);   // stderr — safe
  process.exit(1);
});
```

This mirrors the official "Build an MCP server" bootstrap verbatim: instantiate `StdioServerTransport`, `await server.connect(transport)`, and announce readiness via **`console.error`** so stdout stays clean. [S4][S10]

> Note the import path: `@modelcontextprotocol/sdk/server/stdio.js`. That is the official, documented subpath. [S4]

### 3.2 `Dockerfile`

Your existing base image is fine because Mermaid needs Chromium, and `ghcr.io/puppeteer/puppeteer` bundles it. The only changes: drop `EXPOSE`/`PORT` (no network listener in stdio mode) and make the CMD speak stdio.

```dockerfile
FROM ghcr.io/puppeteer/puppeteer:22

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

# stdio server: no EXPOSE, no PORT. It talks over stdin/stdout.
# Chromium ships with the base image, so DO NOT skip the download in a way
# that removes the browser mermaid-cli needs. Keep the bundled Chromium.
CMD ["node", "dist/server.js"]
```

The general node pattern (slim base, install prod deps, copy `dist/`, `CMD ["node","dist/index.js"]`) is the canonical containerized-stdio shape; the CMD launches a process that speaks stdio over stdin/stdout. [S4][S18][S23] If you ever move off the Puppeteer base to plain `node:22-slim`, you'd need to install Chromium yourself for Mermaid.

> **No `docker compose up` for stdio.** Compose is for long-running services. A stdio server is a short-lived subprocess that Claude Code spawns. Delete `docker-compose.yml` from the Claude Code workflow (keep it only if you also build the HTTP path in Appendix A).

### 3.3 `.mcp.json` (what `claude mcp add` writes)

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

`command: docker` with `args: ["run","-i","--rm", ...]` is the exact, documented shape for a containerized stdio server. [S1][S3][S22]

---

## 4. Step-by-step: build and wire it in

```bash
# 0. Prereqs: Docker Desktop running, Node >= 20, Claude Code installed.

# 1. Build TypeScript and the image
npm run build
docker build -t obsidian-markdown-lint-mcp .

# 2. (Optional but recommended) smoke-test the container speaks stdio.
#    Send an initialize request on stdin; you should get a JSON-RPC reply on stdout.
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | docker run -i --rm obsidian-markdown-lint-mcp
#    Expect a single line of JSON starting with {"result":...}. If you see ANY
#    non-JSON text before it, that's your stdout-corruption bug — find and kill it.

# 3. Register with Claude Code (project scope -> writes .mcp.json in this repo)
claude mcp add obsidian-markdown-lint -s project -- docker run -i --rm obsidian-markdown-lint-mcp

#    Or user scope (available in every project -> writes ~/.claude.json)
#    claude mcp add obsidian-markdown-lint -s user -- docker run -i --rm obsidian-markdown-lint-mcp

# 4. Verify the connection
claude mcp list
#    obsidian-markdown-lint should show "connected".

# 5. Start a NEW Claude Code session. Tools are discovered at session start,
#    so a server added mid-session won't appear until you restart. [S1]
```

Notes:
- Everything **after `--`** is the command Claude Code runs untouched; everything **before** it is Claude's own flags (`-s/--scope`, `-e/--env`, `--transport`). [S1]
- Pass secrets with `-e`: `claude mcp add x -e API_KEY=… -- docker run -i --rm -e API_KEY <image>`. [S3]
- Scopes: `local` (default, `~/.claude.json`, this project only), `project` (`.mcp.json`, committable, prompts teammates for approval), `user` (`~/.claude.json`, all your projects). [S1]
- The on-disk JSON config follows the `mcpServers` shape shown in §3.3. [S1]

---

## 5. Docker Desktop "MCP Toolkit" (beta)

This is the feature you mentioned. It's a **second, alternative path** — you do **not** need it to do everything above. It's a management layer.

### What it is

The **MCP Toolkit** is a management UI built into **Docker Desktop 4.62+** (enable it under **Settings → Beta features → Enable Docker MCP Toolkit**). It has three pieces: [S4-docker][S20][S21]

- **MCP Catalog** — a curated index of 200–300+ verified, containerized MCP servers you launch with one click; credentials handled for you. [S-cat1][S-cat2][S20]
- **MCP Gateway** — a **single** process (`docker mcp gateway run`) that all your enabled servers sit behind. Clients connect **once to the gateway**, and it routes to the right containerized server, handling auth and lifecycle. Servers run in isolated containers, torn down after use. [S16][S17][S19]
- **Clients tab** — one-click connect for supported clients, **including Claude Code**. [S-clients][S-blog1]

### How it changes the Claude Code wiring

Instead of one `.mcp.json` entry per server, the Toolkit writes **one gateway entry** and every enabled server shows up through it:

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run"],
      "type": "stdio"
    }
  }
}
```

Note it's **still stdio** — `command: docker`, `args: ["mcp","gateway","run"]`. The gateway itself speaks stdio to Claude Code and fans out to the containers. [S-gw-cfg][S16]

### Wiring Claude Code to the Toolkit

```bash
# CLI: connect Claude Code to the gateway (writes the MCP_DOCKER entry)
docker mcp client connect claude-code

# Verify
claude mcp list      # MCP_DOCKER should show "connected"; tools appear as /MCP_DOCKER ... [S-blog1]
```

Or do it in the GUI: **MCP Toolkit → Clients → Connect** next to Claude Code, then restart Claude Code. [S-clients]

### Adding *your own* server to the Toolkit

The Catalog is read-only, but you can register a custom/local server in three ways, then run the gateway against your catalog:

```bash
# Build a private catalog and add your server, then run the gateway against it
docker mcp catalog create my-catalog
docker mcp catalog add my-catalog obsidian-markdown-lint ./obsidian-markdown-lint.yaml
docker mcp gateway run --catalog my-catalog
```

Server entries in a profile/catalog can reference an **OCI image** (`docker://obsidian-markdown-lint-mcp:latest`), an **MCP Registry** URL, or a **local file** (`file://./server.yaml`). [S-custom1][S-custom2][S-srcs] The custom-catalog blog is the reference for this; the get-started docs stop short of it. [S-custom1]

### Should you use the Toolkit or plain `claude mcp add`?

| | Plain `claude mcp add -- docker run -i` | MCP Toolkit / Gateway |
|---|---|---|
| Setup | One command, no Docker Desktop beta needed | Enable beta, build catalog for custom servers |
| Config | One `.mcp.json` entry per server | One `MCP_DOCKER` gateway entry for all |
| Best for | A single custom server like yours | Many servers, shared across clients/teams |
| Maturity | Stable, documented | **Beta** |

**Recommendation for your situation:** get the **plain `claude mcp add` stdio path (§3–4) working first.** It has the fewest moving parts and isolates the variable you've been fighting (transport). Adopt the Toolkit later if you want catalog management across multiple clients.

---

## 6. Failure modes & debugging checklist

Ranked by how often they're the actual culprit. [S1][S2][S5][S8][S9][S13][S14][S15][S22]

1. **Something printed to stdout.** A banner, `console.log`, dotenv v17+ ("[dotenv] injecting…"), or a CLI dependency's progress line. → Move all logging to `console.error`; silence noisy libs (e.g. `DOTENV_CONFIG_QUIET=true`). Test with the §4 step-2 smoke test: any non-JSON before the first `{` is the bug.
2. **Missing `-i`.** Container gets immediate EOF on stdin and exits → "server fails to connect." → Always `docker run -i --rm`.
3. **Used `docker compose up` for a stdio server.** Wrong model entirely; compose is for long-running services and its TTY handling differs from `docker run -i`. → Don't; let Claude Code spawn `docker run -i`.
4. **TTY-based transport auto-detection.** Picks the wrong transport under compose/CI. → Choose transport explicitly via env var.
5. **Added server mid-session.** Tools are discovered at session start. → Restart Claude Code; `claude mcp list` to confirm "connected."
6. **Docker daemon not running.** `docker run` fails before the server even starts. → Ensure Docker Desktop is up.
7. **Wrong config file / shape.** `mcpServers` belongs in `.mcp.json` / `~/.claude.json` (Claude Code), not `.claude/settings.json`; a `url` field is HTTP-only. → Use `claude mcp add`.
8. **(Python only) buffered stdout.** Set `PYTHONUNBUFFERED=1`. Not your problem in Node, but listed for completeness.
9. **Image not built / stale.** Rebuild after every `npm run build`: `npm run build && docker build -t obsidian-markdown-lint-mcp .`

---

## Appendix A: the HTTP / Streamable HTTP alternative

If you genuinely want a long-running shared server instead of per-session stdio, here's the *correct* HTTP path — but note it's more complex and not needed for a single local tool.

- Server: use **`StreamableHTTPServerTransport`** (not the deprecated SSE one), exposing a single `/mcp` endpoint that handles POST (JSON-RPC) and GET (SSE stream). [S6][S7]
- Binding: when local, bind to `127.0.0.1` and **validate the `Origin` header** to prevent DNS rebinding; if you must expose it via Docker port-mapping, the listener has to bind `0.0.0.0`. [S6][S13]
- Run it as a real service (this is where `docker compose up -p 3000:3000` *is* appropriate).
- Register with HTTP transport:

```bash
# Claude Code >= 2.1.1
claude mcp add-json obsidian-markdown-lint '{"type":"http","url":"http://localhost:3000/mcp"}'

# Older Claude Code
claude mcp add obsidian-markdown-lint --transport http http://localhost:3000/mcp
```

[S1] (`type` accepts `streamable-http` as an alias for `http`, matching the spec name.)

For HTTP servers the stdout restriction does **not** apply (logging to stdout is fine, since it doesn't share a channel with the protocol). [S2] That's the one rule that relaxes when you leave stdio.

**But again: for your use case, stdio is the right answer.** The HTTP path exists for remote/multi-client scenarios.

---

## Reference templates & sources

### Templates worth copying

- **`alexanderop/mcp-server-starter-ts`** — Docker-ready TypeScript starter, explicit `STARTER_TRANSPORT=stdio|http` env switch (the pattern that should replace your TTY detection). Closest match to your stack. [S12]
- **`github/github-mcp-server`** — the canonical real-world `claude mcp add … -- docker run -i --rm …` example and matching `.mcp.json`. [S3]
- **`microsoft/mcp-for-beginners` (stdio server)** — official multi-language stdio template. [S-msft]
- **`modelcontextprotocol/typescript-sdk`** — the SDK itself; `docs/server.md` is the reference bootstrap. [S10]

### Sources

- **[S1]** Connect Claude Code to tools via MCP — Official Claude Code Docs — https://code.claude.com/docs/en/mcp
- **[S2]** Build an MCP server — MCP official docs (logging-to-stderr rule) — https://modelcontextprotocol.io/docs/develop/build-server
- **[S3]** github-mcp-server install-claude guide — https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md
- **[S4]** Build an MCP server (bootstrap pattern) — https://modelcontextprotocol.io/docs/develop/build-server
- **[S4-docker]** Docker MCP Toolkit (official) — https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/
- **[S5]** docker/compose #13228 — "stdin is not a TTY but stdout is" — https://github.com/docker/compose/issues/13228
- **[S6]** Transports — MCP Specification 2025-06-18 — https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- **[S7]** MCP Spec 2025-03-26 changelog (SSE replaced by Streamable HTTP) — https://modelcontextprotocol.io/specification/2025-03-26/changelog
- **[S8]** ruvnet/ruflo #835 — stdout log corrupts stdio JSON-RPC — https://github.com/ruvnet/ruflo/issues/835
- **[S9]** dirmacs/daedra #4 — stdout logging breaks MCP JSON-RPC — https://github.com/dirmacs/daedra/issues/4
- **[S10]** modelcontextprotocol/typescript-sdk — https://github.com/modelcontextprotocol/typescript-sdk
- **[S11]** justinwlin/claude-mcp-guide (scopes, `.mcp.json` shape) — https://github.com/justinwlin/claude-mcp-guide
- **[S12]** alexanderop/mcp-server-starter-ts — https://github.com/alexanderop/mcp-server-starter-ts
- **[S13]** Streamable HTTP local-binding / Origin rules — MCP Spec 2025-06-18 — https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- **[S14]** Building stdio MCP Servers (MCPcat) — https://mcpcat.io/guides/building-stdio-mcp-server/
- **[S15]** Configure MCP Transport in Docker (MCPcat) — https://mcpcat.io/guides/configuring-mcp-transport-docker/
- **[S16]** docker/mcp-gateway — https://github.com/docker/mcp-gateway
- **[S17]** Docker MCP Catalog and Toolkit (overview) — https://docs.docker.com/ai/mcp-catalog-and-toolkit/
- **[S18]** Building Production-Ready MCP Servers with TypeScript (DEV) — https://dev.to/quantbit/building-production-ready-mcp-servers-with-typescript-a-complete-guide-1ejc
- **[S19]** Get started with Docker MCP Toolkit — https://docs.docker.com/ai/mcp-catalog-and-toolkit/get-started/
- **[S20]** Docker MCP Toolkit (beta enablement, 4.62+) — https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/
- **[S21]** Connect MCP Servers to Claude Desktop with Docker MCP Toolkit (Docker blog) — https://www.docker.com/blog/connect-mcp-servers-to-claude-desktop-with-mcp-toolkit/
- **[S22]** How to Build an MCP Server with Python, Docker, and Claude Code (freeCodeCamp) — https://www.freecodecamp.org/news/how-to-build-an-mcp-server-with-python-docker-and-claude-code/
- **[S23]** Running MCP Servers in Docker (ChatForest) — https://chatforest.com/guides/mcp-docker-containers/
- **[S-blog1]** Add MCP Servers to Claude Code with MCP Toolkit (Docker blog) — https://www.docker.com/blog/add-mcp-servers-to-claude-code-with-mcp-toolkit/
- **[S-cat1/S-cat2/S-clients/S-srcs/S-custom1/S-custom2/S-gw-cfg]** Docker MCP Catalog/Toolkit docs + "Build a Custom MCP Catalog" (Docker blog) — https://docs.docker.com/ai/mcp-catalog-and-toolkit/ , https://www.docker.com/blog/build-custom-mcp-catalog/
- **[S-msft]** microsoft/mcp-for-beginners (stdio server) — https://github.com/microsoft/mcp-for-beginners/blob/main/03-GettingStarted/05-stdio-server/README.md
- **[S-concepts]** Transports (concepts) — https://modelcontextprotocol.io/docs/concepts/transports

> Spec-level facts (transport definitions, the stdout/stderr rule, SSE deprecation) were adversarially verified against the primary MCP spec and confirmed verbatim. Docker MCP Toolkit specifics are beta and may shift; check the official docs links above for the current UI.
