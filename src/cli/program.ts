import { Command, InvalidArgumentError, Option } from 'commander';
import type { OutputFormat } from '../reporter/types.js';

/** Parsed options for the `scan` command. */
export interface ScanCliOptions {
  tokens?: string;
  config?: string;
  format?: OutputFormat;
  out?: string;
  ignore?: string[];
  failOnDrift?: boolean;
  maxDrift?: number;
}

export type ScanHandler = (patterns: string[], options: ScanCliOptions) => Promise<void>;

/** Accumulate a repeatable option's values into an array. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseMaxDrift(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new InvalidArgumentError('must be a non-negative integer');
  }
  return parsed;
}

/**
 * Construct the commander program, delegating the actual scan to `onScan`.
 * The program uses `exitOverride` so the caller controls process termination.
 */
export function buildProgram(onScan: ScanHandler): Command {
  const program = new Command();
  program
    .name('mp-token-drift')
    .description('Detect design system token drift via AST analysis')
    .version('1.0.0')
    .exitOverride();

  program
    .command('scan')
    .description('Scan source files for design token drift')
    .argument('[patterns...]', 'files or globs to scan')
    .option('-t, --tokens <path>', 'path to the design tokens file')
    .option('-c, --config <path>', 'path to drift.config.json')
    .addOption(
      new Option('-f, --format <format>', 'output format').choices([
        'console',
        'pretty',
        'json',
        'sarif',
      ]),
    )
    .option('-o, --out <path>', 'write the report to a file instead of stdout')
    .option('-i, --ignore <glob>', 'glob to exclude (repeatable)', collect, [])
    .option('--fail-on-drift', 'exit non-zero when drift exceeds the threshold')
    .option('--max-drift <n>', 'maximum allowed drift findings', parseMaxDrift)
    .action((patterns: string[], options: ScanCliOptions) => onScan(patterns, options));

  return program;
}
