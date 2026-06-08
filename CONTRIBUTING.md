# Contributing

Thanks for your interest in improving **obsidian-markdown-lint-mcp-server**. This project uses **trunk-based development**: `main` is the single source of truth, it stays always-green and always-releasable, and all work flows through short-lived branches and small pull requests.

## Development model

- **`main` is the trunk.** It must stay releasable at all times. CI runs on every pull request and every push to `main`.
- **Short-lived branches.** Cut a branch from `main`, make a focused change, open a pull request, merge, delete the branch. Aim for hours-to-days, not weeks.
- **No long-lived branches.** There is no `develop` or `release/*` branch. Releases are tags cut directly from `main`.
- **Small, frequent PRs.** Prefer several small pull requests over one large one. If a change is incomplete, keep it guarded rather than parking it on a long-lived branch.
- **Linear history.** Pull requests are squash-merged, so each PR becomes one commit on `main`.

## Prerequisites

- Node.js >= 20
- Docker Desktop (to build the image and exercise the full pipeline)
- A real Chromium locally for the snapshot tests (the Docker image bundles one)

## Getting started

```bash
git clone https://github.com/psenger/obsidian-markdown-lint-mcp-server.git
cd obsidian-markdown-lint-mcp-server
npm install
npm run build
```

## Making a change

1. Branch from an up-to-date `main`:
   ```bash
   git switch main && git pull
   git switch -c feat/short-description
   ```
2. Make the change. Keep it focused and match the surrounding style (TypeScript, ESM). Every tool is content-in/content-out: no disk or network access in tool code.
3. Add or update tests for any behavior change.
4. Run the full local check (all must pass):
   ```bash
   npm run build        # tsc
   npm test             # unit tests; coverage thresholds are enforced
   npm run eval         # tool-correctness evals
   npm run snapshot     # end-to-end fixtures (needs a real Chromium)
   npm audit            # no new advisories
   ```
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`). This keeps release notes meaningful.
6. Open a pull request against `main` and fill in the template. CI must be green before merge.

## Tests

| Command | Covers | Browser |
|---|---|---|
| `npm test` | unit tests, enforced coverage (90% lines/functions/statements, 85% branches) | mocked |
| `npm run eval` | tool correctness against the compiled functions | mocked |
| `npm run snapshot` | byte-for-byte fixtures through the real pipeline | real Chromium |

`src/server.ts` and `src/create-server.ts` are excluded from coverage as pure wiring; they are exercised through an in-memory MCP transport in `tests/unit/create-server.test.ts`.

## Releasing (maintainers)

Releases are semver tags cut from `main`; `package.json` `version` is the source of truth.

1. Make sure `main` is green.
2. Bump the version, which also creates the release commit and the `v<x.y.z>` tag:
   ```bash
   npm version patch   # or minor / major
   ```
3. Push the commit and the tag:
   ```bash
   git push origin main --follow-tags
   ```
4. Publish the GitHub release from the tag:
   ```bash
   gh release create v<x.y.z> --generate-notes
   ```
5. Build and tag the Docker image to match the release:
   ```bash
   docker build -t obsidian-markdown-lint-mcp:<x.y.z> -t obsidian-markdown-lint-mcp:latest .
   ```

## Reporting issues

Use the bug report and feature request templates when opening an issue. For security problems, do **not** open a public issue; follow [SECURITY.md](./SECURITY.md).

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE) and that you will uphold the [Code of Conduct](./CODE_OF_CONDUCT.md).
