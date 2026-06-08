---
type: article
title: Test 1
author: Phil
category: Software Development
tags:
  - mcp
  - docker
  - testing
  - markdown
description: End-to-end test fixture for the markdown-lint MCP server.
summary: 'Exercises lint, front matter validation, Mermaid render, and SVG extract.'
status: draft
version: 1.0.0
date_created: '2026-06-07'
date_updated: '2026-06-07'
---

# Test 1

This note exercises every tool in the markdown-lint MCP server.

## A flowchart

```mermaid
flowchart LR
  A[Start] --> B{Works?}
  B -->|yes| C[Ship it]
  B -->|no| A
```

## A sequence diagram

```mermaid
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: initialize
  S-->>U: tools/list
  U->>S: tools/call render_mermaid_diagrams
  S-->>U: SVG
```

#### Notes

Heading jumped from level 2 to level 4 on purpose, to give lint_markdown a finding.
