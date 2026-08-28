# 🎯 mp-token-drift

> Design System Drift Auditor & Refactor Engine for React codebases. Built natively as a CLI tool and MCP (Model Context Protocol) Server for Cursor & Magic Patterns Agent workflows.

<!-- [![CI Suite](https://github.com/YOUR_GITHUB_USERNAME/mp-token-drift/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_USERNAME/mp-token-drift/actions) -->

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

---

## 💡 The Problem

When product teams move quickly from AI-generated prototypes to production codebases, **design system drift** inevitably occurs:

- Engineers add arbitrary Tailwind utility classes (e.g., `p-[13px]`, `rounded-[7px]`).
- Hardcoded inline HEX colors bypass design tokens (e.g., `style={{ color: '#1a73e8' }}`).
- Code reviews slow down while inspecting UI token compliance manually.

`mp-token-drift` solves this by using AST parsing to detect non-standard token usage and applying Delta-E color-distance matching to suggest the nearest approved design token — reported in your terminal, as JSON, or as SARIF for CI.

---

## ✨ Features

- 🔍 **Babel AST Code Scanner:** Parses React/JSX/TSX files to identify hardcoded inline styles and arbitrary Tailwind brackets without regex brittleness. Handles template literals, `cn()`/`clsx()` utilities, ternaries, `var()` fallbacks, and external style constants.
- 🎨 **Delta-E Token Matcher:** Maps rogue colors to the nearest valid token using CIEDE2000 perceptual color distance (via [`culori`](https://culorijs.org/)), and maps off-scale spacings/radii to the closest utility. Understands `rem`→`px`, short hex, `rgb()/hsl()/oklch()`, and prefixed color classes (`bg-[#…]` → `bg-brand-primary`).
- 🛠️ **Production CLI & Reporters:** `scan` command with glob input, ignore patterns, and `console` / `pretty` / `json` / `sarif` output. Emits [SARIF v2.1.0](https://sarifweb.azurewebsites.net/) for GitHub code scanning, gates CI via `--fail-on-drift`, and auto-detects `CI` to strip ANSI colors.
- ⚙️ **Config & Suppression:** Zero-config via an auto-discovered `drift.config.json`, plus `// drift-ignore` / `/* drift-disable */` inline suppression directives.

> 🚧 **Roadmap (not yet implemented):** interactive/auto-fix rewrites and a native MCP (Model Context Protocol) server for Cursor / agent workflows.

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/tharun-ragu22/mp-token-drift.git
cd mp-token-drift

# Install dependencies
npm install

# Build the CLI (compiles src/ -> dist/)
npm run build
```

### Run your first scan

```bash
# Scan the sample fixtures against the sample tokens
node dist/index.js scan "fixtures/sample-app/**/*.tsx" --tokens fixtures/tokens.sample.json
```

```text
fixtures/sample-app/BadCard.tsx:5  arbitrary-class  p-[13px] → p-3
fixtures/sample-app/BadCard.tsx:6  hardcoded-color  #1a73e8 → brand-primary

2 drift issue(s) found.
```

Because a `drift.config.json` ships in the repo root, you can also just run the convenience scripts (see [Scripts](#-npm-scripts)):

```bash
npm run scan          # console report
npm run scan:json     # machine-readable JSON
npm run scan:ci       # SARIF + non-zero exit on drift
```

---

## 🖥️ CLI Usage

```
mp-token-drift scan [options] [patterns...]
```

`patterns` are files or globs (quote them so your shell doesn't pre-expand). If omitted, the `include` globs from your config are used.

| Option                | Description                                                | Default     |
| --------------------- | ---------------------------------------------------------- | ----------- |
| `-t, --tokens <path>` | Design-tokens file to match against                        | from config |
| `-c, --config <path>` | Explicit `drift.config.json` (else auto-discovered in cwd) | —           |
| `-f, --format <fmt>`  | `console`, `pretty`, `json`, or `sarif`                    | `console`   |
| `-o, --out <path>`    | Write the report to a file instead of stdout               | stdout      |
| `-i, --ignore <glob>` | Glob to exclude (repeatable)                               | —           |
| `--fail-on-drift`     | Exit non-zero when findings exceed `--max-drift`           | off         |
| `--max-drift <n>`     | Allowed findings before failing                            | `0`         |

### Exit codes

| Code | Meaning                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| `0`  | Success — no drift, or drift found but not gated                                        |
| `1`  | Drift exceeded `--max-drift` while `--fail-on-drift` was set                            |
| `2`  | User error — missing/invalid tokens, missing/malformed config, or an invalid `--format` |

JSON and SARIF payloads are written **only to stdout**; diagnostics (e.g. "Report written to …") go to stderr, so `--format json | jq` stays clean.

---

## 🎨 Tokens file

The matcher validates the tokens file against a strict schema (`colors`, `spacing`, `radius`). Scale keys double as the Tailwind suffix used in suggestions (`spacing.3` → `p-3`, `radius.md` → `rounded-md`). See [`fixtures/tokens.sample.json`](fixtures/tokens.sample.json):

```json
{
  "colors": { "brand-primary": "#1a73e8", "danger": "#d93025", "white": "#ffffff" },
  "spacing": { "1": "4px", "2": "8px", "3": "12px", "4": "16px" },
  "radius": { "sm": "2px", "md": "8px", "lg": "12px", "full": "9999px" }
}
```

Matching thresholds: colors match within a CIEDE2000 Delta-E of ~10 (0 = identical); dimensions match within a few pixels of the nearest scale step. Values beyond threshold report **no suggestion** rather than a wrong one.

---

## ⚙️ Configuration

A `drift.config.json` in the working directory is auto-discovered (or point at one with `--config`). CLI flags override config values, which override built-in defaults.

```json
{
  "tokens": "fixtures/tokens.sample.json",
  "include": ["fixtures/**/*.tsx"],
  "ignore": ["**/node_modules/**", "**/dist/**"],
  "format": "console",
  "failOnDrift": false,
  "maxDrift": 0
}
```

A missing default config is fine (defaults apply); a config passed via `--config` that is missing or malformed exits with code `2`.

---

## 🙈 Suppressing findings

Add a `drift-ignore` or `drift-disable` comment inline or on the line directly above a finding:

```tsx
{/* drift-ignore */}
<span style={{ color: '#123456' }} />        {/* skipped */}

<span style={{ color: '#00ff00' }} /> // drift-disable  (inline also works)
```

---

## 📦 npm scripts

| Script                                  | Command                                       |
| --------------------------------------- | --------------------------------------------- |
| `npm run scan`                          | `scan` with the console reporter              |
| `npm run scan:json`                     | `scan --format json`                          |
| `npm run scan:sarif`                    | SARIF to `drift-report.sarif` (never fails)   |
| `npm run scan:ci`                       | Same, but exits non-zero on drift (hard gate) |
| `npm run build`                         | Compile `src/` → `dist/`                      |
| `npm test`                              | Run the Vitest suite                          |
| `npm run typecheck` / `lint` / `format` | Static checks                                 |

> All `scan` scripts run the compiled binary, so run `npm run build` first (or after code changes).

---

## 🤖 Continuous Integration

The tool emits [SARIF v2.1.0](https://sarifweb.azurewebsites.net/), so findings can show up in the GitHub **Security → Code scanning** tab. A ready-to-use workflow ships in [`.github/workflows/token-drift.yml`](.github/workflows/token-drift.yml):

```yaml
permissions:
  contents: read
  security-events: write # required to upload SARIF

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.x', cache: npm }
      - run: npm ci
      - run: npm run build
      - name: Generate drift report (SARIF)
        run: npm run scan:sarif # writes drift-report.sarif, never fails
      - name: Upload SARIF to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: drift-report.sarif
          category: mp-token-drift
      # Optional hard gate — uncomment to fail PRs that introduce drift:
      # - name: Enforce drift budget
      #   run: npm run scan:ci
```

Notes:

- **Report generation vs. gating are separate.** `scan:sarif` only writes the report (exit 0), so findings surface as alerts without a scary failed step. Add the `scan:ci` step to hard-fail PRs that exceed the `maxDrift` budget in your config.
- Uploading requires the **`security-events: write`** permission; on public repos code scanning is free, private repos need GitHub Advanced Security. PRs from forks get a read-only token and can't upload.

---

## 🧱 Project layout

```
src/
  scanner/astScanner.ts   # Babel AST scan → Finding[]
  matcher/                # Delta-E color + dimension token matching
  config/loadConfig.ts    # defaults < drift.config.json < CLI flags
  reporter/               # console / json / sarif renderers
  cli/                    # arg parsing, scan orchestration, run()
tests/                    # Vitest suites (scanner, matcher, cli)
fixtures/                 # sample components + tokens files
```
