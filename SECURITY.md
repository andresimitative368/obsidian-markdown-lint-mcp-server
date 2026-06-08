# Security policy

## Supported versions

This project is pre-1.0; only the latest release on `main` receives security fixes.

| Version | Supported |
|---|---|
| latest (`main`) | yes |
| older tags | no |

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. That opens a private thread with the maintainers.

Expect an acknowledgement within a few days, and a fix or mitigation as quickly as the severity warrants.

## Scope notes

This is a stdio MCP server that renders untrusted Markdown and Mermaid with headless Chromium (launched with `--no-sandbox`, the standard for containerized Chromium). Run the container with the hardening flags documented in the [README](./README.md#hardening-optional) (`--network none`, `--security-opt no-new-privileges`, and optionally `--read-only --tmpfs /tmp --cap-drop ALL`) to limit blast radius. The tools perform no disk or network I/O themselves; the host client owns all file access.
