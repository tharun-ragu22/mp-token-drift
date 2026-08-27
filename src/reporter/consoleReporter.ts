import { Chalk } from 'chalk';
import type { DriftItem } from './types.js';

/**
 * Decide whether to emit ANSI colors. Colors are on by default but disabled in
 * CI or when NO_COLOR is set, so piped/CI logs stay clean and machine-readable.
 */
function colorsDisabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return true;
  const ci = process.env.CI;
  return ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0';
}

/** Render findings as a human-readable, optionally colorized console report. */
export function formatConsole(items: DriftItem[]): string {
  const c = new Chalk({ level: colorsDisabled() ? 0 : 1 });

  if (items.length === 0) {
    return c.green('✔ No token drift detected.');
  }

  const lines = items.map((item) => {
    const location = c.dim(`${item.file}:${item.line}`);
    const value = c.red(item.value);
    const suggestion = item.suggestion ? c.green(` → ${item.suggestion}`) : '';
    return `${location}  ${c.yellow(item.type)}  ${value}${suggestion}`;
  });

  const summary = c.bold(`\n${items.length} drift issue(s) found.`);
  return [...lines, summary].join('\n');
}
