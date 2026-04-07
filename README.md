# agent-usage-report

`agent-usage-report` scans local agent usage data on your machine and generates a self-contained HTML report you can open directly in the browser.

Current providers:
- Codex
- Claude Code
- OpenCode
- Pi Coding Agent

Features:
- GitHub-style daily heatmap
- Per-provider and combined views
- Estimated token-cost reporting
- Daily cost tables
- Monthly spend-vs-plan comparison for Codex and Claude
- Claude legacy activity fallback from `history.jsonl`

## Quick Start

Run without installing globally:

```bash
npx agent-usage-report@latest
```

With Bun:

```bash
bunx agent-usage-report@latest
```

Local development:

```bash
pnpm install
pnpm run build
node dist/cli.js
```

## Usage

```bash
agent-usage-report \
  --codex-home ~/.codex \
  --claude-config-dir ~/.config/claude,~/.claude \
  --opencode-dir ~/.local/share/opencode \
  --pi-agent-dir ~/.pi/agent \
  --timezone America/Mexico_City \
  --output-html agent-usage-report.html \
  --output-json agent-usage-data.json
```

Flags:
- `--codex-home`: Codex home directory
- `--claude-config-dir`: Claude config directory or comma-separated directories
- `--opencode-dir`: OpenCode data directory
- `--pi-agent-dir`: Pi Coding Agent directory or sessions directory
- `--timezone`: IANA timezone for day bucketing
- `--output-html`: HTML output path
- `--output-json`: JSON output path
- `--color`: force colored progress output
- `--no-color`: disable colored progress output
- `--skip-archived`: skip `~/.codex/archived_sessions`

## Privacy

The CLI reads local usage data and generates local files.

The generated HTML and JSON reports stay on your machine unless you choose to share them manually.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```
