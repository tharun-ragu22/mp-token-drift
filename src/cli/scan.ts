import { glob } from 'glob';
import { loadConfig, type ResolvedConfig } from '../config/loadConfig.js';
import { loadTokens } from '../matcher/schema.js';
import { TokenMatcher } from '../matcher/tokenMatcher.js';
import { scanFile, type Finding } from '../scanner/astScanner.js';
import { render } from '../reporter/index.js';
import { writeReport } from '../reporter/fileWriter.js';
import type { DriftItem } from '../reporter/types.js';
import { CliError } from './CliError.js';
import type { ScanCliOptions } from './program.js';

export interface ScanOutcome {
  stdout: string;
  stderr: string;
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
 * Annotate each finding with an LLM explanation. The agent module (and the AI
 * SDK it pulls in) is imported lazily so the default, AI-disabled scan path
 * never loads it. Failures are reported once to stderr and leave findings
 * intact so a missing key or provider error can't abort the whole scan.
 */
async function enrichWithAi(
  items: DriftItem[],
  matcher: TokenMatcher,
  ai: ResolvedConfig['ai'],
): Promise<{ items: DriftItem[]; warning: string }> {
  if (items.length === 0) return { items, warning: '' };

  const { explainDrift } = await import('../agent/explainDrift.js');
  const options = { enabled: true, provider: ai.provider, model: ai.model };

  try {
    const enriched = await Promise.all(
      items.map(async (item) => {
        const result = await explainDrift(
          {
            value: item.value,
            type: item.type,
            baselineSuggestion: item.suggestion,
            candidates: matcher.candidatesFor(item.value),
          },
          options,
        );
        return { ...item, explanation: result.explanation, confidence: result.confidence };
      }),
    );
    return { items: enriched, warning: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { items, warning: `AI explanations unavailable: ${message}\n` };
  }
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
    out: options.out,
    failOnDrift: options.failOnDrift,
    maxDrift: options.maxDrift,
    enableAi: options.enableAi,
    llmProvider: options.llmProvider,
    llmModel: options.llmModel,
  });

  const matcher = loadMatcher(config.tokens);
  const files = await resolveFiles(config);
  let items = collectDrift(files, matcher);

  // Only the human-readable console formats surface explanations, so we skip
  // the LLM round-trips entirely for json/sarif output.
  const consoleFormat = config.format === 'console' || config.format === 'pretty';
  let aiWarning = '';
  if (config.ai.enabled && consoleFormat) {
    const enriched = await enrichWithAi(items, matcher, config.ai);
    items = enriched.items;
    aiWarning = enriched.warning;
  }

  const report = render(items, config.format);
  const exitCode = config.failOnDrift && items.length > config.maxDrift ? 1 : 0;

  if (config.out) {
    writeReport(config.out, report);
    return { stdout: '', stderr: `${aiWarning}Report written to ${config.out}\n`, exitCode };
  }
  return { stdout: report, stderr: aiWarning, exitCode };
}
