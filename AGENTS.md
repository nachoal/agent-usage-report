# AGENTS.md - agent-usage-report

## Scope
- This is a standalone TypeScript CLI package intended for `pnpm`, `bun`, `node`, and eventual `npx` usage.

## Purpose
- Generate a self-contained local agent usage HTML report and JSON payload
- Maintain feature parity with the Python implementation in the sibling local project
- Support current local providers:
  - Codex
  - Claude Code
  - OpenCode
  - Pi Coding Agent
- Preserve provider-aware reporting:
  - per-provider views
  - combined view
  - daily totals
  - monthly rollups
  - Codex and Claude monthly spend-vs-plan comparison
  - Claude `history.jsonl` activity-only fallback days

## Primary Entry Points
- CLI entry: `src/cli.ts`
- Core logic: `src/generator.ts`
- HTML template: `src/template.html`
- Tests: `test/generator.test.ts`

## Build And Test
- Install: `pnpm install`
- Typecheck: `pnpm run typecheck`
- Test: `pnpm run test`
- Build: `pnpm run build`
- Smoke run:
  - `node dist/cli.js --help`
  - `bun run src/cli.ts --help`

## Packaging Expectations
- Package name: `agent-usage-report`
- Intended runner UX:
  - `npx agent-usage-report@latest`
  - `bunx agent-usage-report@latest`
- Do not introduce native dependencies unless strictly required for distribution.
- Prefer Node built-ins over native modules when possible so package-runner adoption stays easy.

## Current CLI Surface
- `--codex-home`
- `--claude-config-dir`
- `--opencode-dir`
- `--pi-agent-dir`
- `--timezone`
- `--output-html`
- `--output-json`
- `--skip-archived`

## Implementation Notes
- Keep the JSON payload shape aligned with the Python project:
  - `schemaVersion`
  - `providerOrder`
  - `providers`
  - `combined`
  - top-level default-provider mirrors
- Claude `history.jsonl` days are activity-only:
  - they should render in the heatmap
  - they must not contribute to token totals or spend
- OpenCode should prefer `opencode.db` when available and fall back to `storage/message/**/*.json`

## Editing Guidance
- Prefer targeted edits in `src/generator.ts` until the port stabilizes
- If changing the UI, edit `src/template.html` or the template-loading flow carefully
- After behavior changes:
  - rerun `pnpm run typecheck`
  - rerun `pnpm run test`
  - rerun `pnpm run build`

## Non-Goals
- Do not turn this into a monorepo unless clearly needed
- Do not add a backend here
- Do not reduce current provider/report parity with the Python version
