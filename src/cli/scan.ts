import { glob } from 'glob';
import { loadConfig, type ResolvedConfig } from '../config/loadConfig.js';
import { loadTokens } from '../matcher/schema.js';
import { TokenMatcher } from '../matcher/tokenMatcher.js';
import { scanFile, type Finding } from '../scanner/astScanner.js';
import { render } from '../reporter/index.js';
import type { DriftItem } from '../reporter/types.js';
import { CliError } from './CliError.js';
import type { ScanCliOptions } from './program.js';

export interface ScanOutcome {
  text: string;
  exitCode: number;
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

/**
 * Resolve configuration, scan the matched files, annotate findings with token
 * suggestions, and render the report. Returns the rendered text plus the exit
 * code implied by the `--fail-on-drift`/`--max-drift` gate.
 */
export async function runScan(patterns: string[], options: ScanCliOptions): Promise<ScanOutcome> {
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
