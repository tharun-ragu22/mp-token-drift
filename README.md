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

`mp-token-drift` solves this by using AST parsing to detect non-standard token usage, applying mathematical Delta-E color distance matching to find approved design tokens, and generating clean AST refactoring patches.

---

## ✨ Features

- 🔍 **Babel AST Code Scanner:** Parses React/JSX files to identify hardcoded inline styles and arbitrary Tailwind brackets without regex brittleness.
- 🎨 **Delta-E Token Matcher:** Maps rogue HEX colors and non-grid pixel spacings to the nearest valid token defined in your `tokens.json`.
- 🛠️ **CLI Audit & Interactive Fix Modes:** Terminal interface for inspecting codebase health or interactively applying token rewrites.
- 🔌 **Native MCP Support:** Includes an Model Context Protocol (MCP) server integration so IDEs like Cursor or agentic canvases can call `audit_design_drift` as a native tool.
- ⚡ **Zero-Context Waste:** Performs local static analysis before handing snippets to LLM context rings.

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone [https://github.com/YOUR_GITHUB_USERNAME/mp-token-drift.git](https://github.com/YOUR_GITHUB_USERNAME/mp-token-drift.git)
cd mp-token-drift

# Install dependencies
npm install

# Build CLI binary
npm run build