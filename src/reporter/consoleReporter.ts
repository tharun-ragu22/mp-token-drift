import { createChalk } from './colors.js';
import type { DriftItem } from './types.js';

/** Render findings as a human-readable, optionally colorized console report. */
export function formatConsole(items: DriftItem[]): string {
  const c = createChalk();

  if (items.length === 0) {
    return c.green('✔ No token drift detected.');
  }

  const lines = items.map((item) => {
    const location = c.dim(`${item.file}:${item.line}`);
    const value = c.red(item.value);
    const suggestion = item.suggestion ? c.green(` → ${item.suggestion}`) : '';
    const finding = `${location}  ${c.yellow(item.type)}  ${value}${suggestion}`;

    if (item.explanation) {
      const confidence =
        item.confidence !== undefined ? ` (${Math.round(item.confidence * 100)}% confidence)` : '';
      return `${finding}\n${c.cyan(`    ↳ ${item.explanation}${confidence}`)}`;
    }
    return finding;
  });

  const summary = c.bold(`\n${items.length} drift issue(s) found.`);
  return [...lines, summary].join('\n');
}
