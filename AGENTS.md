# AGENTS.md - agent-usage-report

## Scope

- This is a standalone TypeScript CLI package intended for `pnpm`, `bun`, `node`, and eventual `npx` usage.
- The public repository is `https://github.com/nachoal/agent-usage-report`
- The npm package is `agent-usage-report`

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
  - shareable PNG poster output that follows the current design direction

## Primary Entry Points

- CLI entry: `src/cli.ts`
- Core logic: `src/generator.ts`
- HTML template: `src/template.html`
- Share renderer: `src/share.ts`
- Tests: `test/generator.test.ts`
- Public package metadata: `package.json`

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
- Current published version: `0.1.2`
- Publishable files should stay minimal:
  - keep `dist`, `README.md`, and `LICENSE`
  - do not publish `AGENTS.md`
- Do not introduce native dependencies unless strictly required for distribution.
- Prefer Node built-ins over native modules when possible so package-runner adoption stays easy.
- Build output must remain flat under `dist/`:
  - `dist/cli.js`
  - `dist/generator.js`
  - `dist/template.html`

## Current CLI Surface

- `--codex-home`
- `--claude-config-dir`
- `--opencode-dir`
- `--pi-agent-dir`
- `--timezone`
- `--output-html`
- `--output-json`
- `--share-png`
- `--share-output`
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
- Current providers with parity work completed:
  - Codex
  - Claude Code
  - OpenCode
  - Pi Coding Agent
- Current report features:
  - provider-aware heatmap
  - combined provider view
  - daily cost table
  - monthly rollups
  - Codex and Claude spend-vs-plan section
  - Claude activity-only fallback from `history.jsonl`
  - shareable poster PNG for all available providers or the single available provider

## Editing Guidance

- Prefer targeted edits in `src/generator.ts` until the port stabilizes
- If changing the UI, edit `src/template.html` or the template-loading flow carefully
- After behavior changes:
  - rerun `pnpm run typecheck`
  - rerun `pnpm run test`
  - rerun `pnpm run build`
- Before publishing:
  - rerun `pnpm run check`
  - rerun `npm pack --dry-run`
  - verify the tarball does not include duplicate `dist/src/*` output
- Publish flow:
  - bump `package.json` version
  - commit and push
  - `npm publish --otp=<code>` if npm requires OTP
  - verify with `npm view agent-usage-report version dist-tags.latest`
  - smoke test with `npx agent-usage-report@latest --help`

## Non-Goals

- Do not turn this into a monorepo unless clearly needed
- Do not add a backend here
- Do not reduce current provider/report parity with the Python version
