import type { FindingType } from '../scanner/astScanner.js';

/** A single drift finding, enriched with its source file and a token suggestion. */
export interface DriftItem {
  file: string;
  line: number;
  type: FindingType;
  value: string;
  /** The nearest design-system token, or null when none is close enough. */
  suggestion: string | null;
}

export type OutputFormat = 'console' | 'pretty' | 'json' | 'sarif';
