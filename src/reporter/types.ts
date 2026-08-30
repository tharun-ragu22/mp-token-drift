import type { FindingType } from '../scanner/astScanner.js';

/** A single drift finding, enriched with its source file and a token suggestion. */
export interface DriftItem {
  file: string;
  line: number;
  type: FindingType;
  value: string;
  /** The nearest design-system token, or null when none is close enough. */
  suggestion: string | null;
  /**
   * The token the LLM recommended, populated only when the AI agent ran. Used
   * by `--fix` in preference to the deterministic `suggestion` when present.
   */
  aiSuggestion?: string | null;
  /** Optional LLM rationale, populated only when the AI agent is enabled. */
  explanation?: string;
  /** The LLM's confidence in its suggestion, 0..1, when an explanation exists. */
  confidence?: number;
}

export type OutputFormat = 'console' | 'pretty' | 'json' | 'sarif';
