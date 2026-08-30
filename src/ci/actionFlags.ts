/**
 * Translation layer between the `action.yml` composite-action inputs and the
 * `mp-token-drift scan` CLI. Keeping the mapping here (rather than inline in the
 * action's shell step) makes it unit-testable and gives the manifest a single
 * source of truth for the set of supported inputs.
 */

/**
 * The canonical list of inputs the action exposes, in `action.yml` (kebab-case)
 * spelling. The manifest is asserted against this list so the two never drift.
 */
export const ACTION_INPUT_NAMES = [
  'tokens',
  'config',
  'patterns',
  'format',
  'output',
  'fail-on-drift',
  'max-drift',
  'enable-ai',
] as const;

/** Default SARIF artifact path the action uploads to GitHub Code Scanning. */
export const SARIF_OUTPUT_PATH = 'code-scanning.sarif';

/** Action inputs as consumed by the flag builder (camel-cased for ergonomics). */
export interface ActionInputs {
  tokens?: string;
  config?: string;
  /** Whitespace-separated globs; empty means "use the config's include". */
  patterns?: string;
  format?: string;
  output?: string;
  failOnDrift?: boolean;
  maxDrift?: string;
  enableAi?: boolean;
}

/** Treat a missing or blank string input as "not provided". */
function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Build the argv (minus the binary name) for `mp-token-drift scan` from the
 * resolved action inputs. Absent, blank, or false-valued inputs contribute no
 * flags so the CLI falls back to its own defaults.
 */
export function buildScanArgs(inputs: ActionInputs): string[] {
  const args: string[] = ['scan'];

  // Positional globs come first, one argument per whitespace-separated token.
  if (present(inputs.patterns)) {
    args.push(...inputs.patterns.trim().split(/\s+/));
  }

  if (present(inputs.tokens)) args.push('--tokens', inputs.tokens);
  if (present(inputs.config)) args.push('--config', inputs.config);
  if (present(inputs.format)) args.push('--format', inputs.format);
  if (present(inputs.output)) args.push('--out', inputs.output);
  if (present(inputs.maxDrift)) args.push('--max-drift', inputs.maxDrift);
  if (inputs.failOnDrift) args.push('--fail-on-drift');
  if (inputs.enableAi) args.push('--enable-ai');

  return args;
}
