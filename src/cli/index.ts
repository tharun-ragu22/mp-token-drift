import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { glob } from 'glob';
import { loadConfig, type ResolvedConfig } from '../config/loadConfig.js';
import { loadTokens } from '../matcher/schema.js';
import { TokenMatcher } from '../matcher/tokenMatcher.js';
import { scanFile, type Finding } from '../scanner/astScanner.js';
import { formatConsole } from '../reporter/consoleReporter.js';
import { formatJson } from '../reporter/jsonReporter.js';
import { formatSarif } from '../reporter/sarifReporter.js';
import type { DriftItem, OutputFormat } from '../reporter/types.js';
import { CliError } from './CliError.js';

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ScanCliOptions {
  tokens?: string;
  config?: string;
  format?: OutputFormat;
  ignore?: string[];
  failOnDrift?: boolean;
  maxDrift?: number;
}

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

/** Look up the closest design-system token to suggest for a finding. */
function suggestToken(matcher: TokenMatcher, finding: Finding): string | null {
  return finding.type === 'hardcoded-color'
    ? matcher.matchColor(finding.value).matchedToken
    : matcher.matchClass(finding.value).matchedToken;
}

function loadMatcher(tokensPath: string): TokenMatcher {
  try {
    return new TokenMatcher(loadTokens(tokensPath));
  } catch (error) {
    throw new CliError(2, error instanceof Error ? error.message : String(error));
  }
}

async function resolveFiles(config: ResolvedConfig): Promise<string[]> {
  const matches = await glob(config.include, { ignore: config.ignore, nodir: true });
  return matches.sort();
}

function collectDrift(files: string[], matcher: TokenMatcher): DriftItem[] {
  const items: DriftItem[] = [];
  for (const file of files) {
    for (const finding of scanFile(file)) {
      items.push({
        file,
        line: finding.line,
        type: finding.type,
        value: finding.value,
        suggestion: suggestToken(matcher, finding),
      });
    }
  }
  return items;
}

function render(items: DriftItem[], format: OutputFormat): string {
  switch (format) {
    case 'json':
      return formatJson(items);
    case 'sarif':
      return formatSarif(items);
    case 'console':
      return formatConsole(items);
  }
}

async function runScan(
  patterns: string[],
  options: ScanCliOptions,
): Promise<{ text: string; exitCode: number }> {
  const config = loadConfig({
    configPath: options.config,
    tokens: options.tokens,
    patterns,
    ignore: options.ignore,
    format: options.format,
    failOnDrift: options.failOnDrift,
    maxDrift: options.maxDrift,
  });

  const matcher = loadMatcher(config.tokens);
  const files = await resolveFiles(config);
  const items = collectDrift(files, matcher);

  const exceededThreshold = config.failOnDrift && items.length > config.maxDrift;
  return { text: render(items, config.format), exitCode: exceededThreshold ? 1 : 0 };
}

function buildProgram(sink: {
  out: string[];
  onScan: (patterns: string[], options: ScanCliOptions) => Promise<void>;
}): Command {
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
      new Option('-f, --format <format>', 'output format').choices(['console', 'json', 'sarif']),
    )
    .option('-i, --ignore <glob>', 'glob to exclude (repeatable)', collect, [])
    .option('--fail-on-drift', 'exit non-zero when drift exceeds the threshold')
    .option('--max-drift <n>', 'maximum allowed drift findings', parseMaxDrift)
    .action((patterns: string[], options: ScanCliOptions) => sink.onScan(patterns, options));

  return program;
}

/**
 * Parse and execute CLI arguments, capturing all output and the intended exit
 * code instead of writing to the process directly. This keeps the CLI testable
 * and lets the thin bin wrapper own the actual `process.exit`.
 */
export async function run(argv: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode = 0;

  const program = buildProgram({
    out,
    onScan: async (patterns, options) => {
      const { text, exitCode: scanExit } = await runScan(patterns, options);
      out.push(text);
      exitCode = scanExit;
    },
  });
  program.configureOutput({
    writeOut: (str) => out.push(str),
    writeErr: (str) => err.push(str),
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CliError) {
      err.push(`${error.message}\n`);
      exitCode = error.exitCode;
    } else if (error instanceof CommanderError) {
      // Help/version/usage errors: commander already wrote the message.
      exitCode = error.exitCode;
    } else {
      err.push(`${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 2;
    }
  }

  return { stdout: out.join(''), stderr: err.join(''), exitCode };
}
