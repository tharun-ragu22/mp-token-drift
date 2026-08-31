import { Command, InvalidArgumentError } from 'commander';
import type { OutputFormat } from '../reporter/types.js';
import { CliError } from './CliError.js';

const VALID_FORMATS: readonly OutputFormat[] = ['console', 'pretty', 'json', 'sarif'];

/** Parsed options for the `scan` command. */
export interface ScanCliOptions {
  tokens?: string;
  config?: string;
  format?: OutputFormat;
  out?: string;
  ignore?: string[];
  failOnDrift?: boolean;
  maxDrift?: number;
  enableAi?: boolean;
  llmProvider?: string;
  llmModel?: string;
  fix?: boolean;
  dryRun?: boolean;
  parallel?: boolean;
  sequential?: boolean;
  maxWorkers?: number;
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

function parseMaxWorkers(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

/** Validate --format, exiting with code 2 (a config error) on an unknown value. */
function parseFormat(value: string): OutputFormat {
  if ((VALID_FORMATS as readonly string[]).includes(value)) {
    return value as OutputFormat;
  }
  throw new CliError(2, `Invalid --format "${value}". Choose one of: ${VALID_FORMATS.join(', ')}.`);
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
    .option('-f, --format <format>', 'output format (console|pretty|json|sarif)', parseFormat)
    .option('-o, --out <path>', 'write the report to a file instead of stdout')
    .option('-i, --ignore <glob>', 'glob to exclude (repeatable)', collect, [])
    .option('--fail-on-drift', 'exit non-zero when drift exceeds the threshold')
    .option('--max-drift <n>', 'maximum allowed drift findings', parseMaxDrift)
    .option('--enable-ai', 'use the LLM reasoning agent to explain drift')
    .option('--llm-provider <provider>', 'LLM provider (anthropic|google|openai)')
    .option('--llm-model <model>', 'LLM model id (defaults to the provider default)')
    .option('--fix', 'rewrite drift in place, replacing values with design tokens')
    .option('--dry-run', 'with --fix, print the diff to stdout instead of writing files')
    .option('--parallel', 'force parallel scanning across worker threads')
    .option('--sequential', 'force single-threaded scanning on the main thread')
    .option('--max-workers <n>', 'cap the worker-thread pool size', parseMaxWorkers)
    .action((patterns: string[], options: ScanCliOptions) => onScan(patterns, options));

  return program;
}
