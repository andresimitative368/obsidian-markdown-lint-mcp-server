# Multi-arch Node base — builds natively on Apple Silicon (arm64) and amd64,
# so Chromium does NOT run under emulation.
FROM node:26-bookworm-slim

# Chromium for Mermaid rendering, installed from Debian so it is native on the
# build platform. apt pulls in the shared libraries Chromium needs; the fonts
# package gives text in rendered diagrams something to measure against.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Puppeteer (a transitive dependency of @mermaid-js/mermaid-cli) must use the
# system Chromium above instead of downloading its own copy. The render code in
# src/tools/mermaid.ts launches with --no-sandbox, so running headless Chromium
# inside the container works without extra privileges.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

# This is a stdio MCP server. It speaks JSON-RPC over stdin/stdout — there is
# no network listener, so no EXPOSE and no port. Claude Code launches it with
# `docker run -i --rm obsidian-markdown-lint-mcp` (the -i keeps stdin open).
CMD ["node", "dist/server.js"]
