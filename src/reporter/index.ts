import { formatConsole } from './consoleReporter.js';
import { formatJson } from './jsonReporter.js';
import { formatSarif } from './sarifReporter.js';
import type { DriftItem, OutputFormat } from './types.js';

/** Render drift findings in the requested output format. */
export function render(items: DriftItem[], format: OutputFormat): string {
  switch (format) {
    case 'json':
      return formatJson(items);
    case 'sarif':
      return formatSarif(items);
    case 'console':
    case 'pretty':
      return formatConsole(items);
  }
}

export type { DriftItem, OutputFormat } from './types.js';
