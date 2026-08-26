import chalk from 'chalk';
import type { DriftItem } from './types.js';

/** Render findings as a human-readable, colorized console report. */
export function formatConsole(items: DriftItem[]): string {
  if (items.length === 0) {
    return chalk.green('✔ No token drift detected.');
  }

  const lines = items.map((item) => {
    const location = chalk.dim(`${item.file}:${item.line}`);
    const value = chalk.red(item.value);
    const suggestion = item.suggestion ? chalk.green(` → ${item.suggestion}`) : '';
    return `${location}  ${chalk.yellow(item.type)}  ${value}${suggestion}`;
  });

  const summary = chalk.bold(`\n${items.length} drift issue(s) found.`);
  return [...lines, summary].join('\n');
}
