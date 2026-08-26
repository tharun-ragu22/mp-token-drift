import type { DriftItem } from './types.js';

/** Serialize drift findings as a structured JSON report. */
export function formatJson(items: DriftItem[]): string {
  return JSON.stringify(
    {
      version: '1.0.0',
      summary: { total: items.length },
      findings: items,
    },
    null,
    2,
  );
}
