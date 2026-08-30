import { readFileSync, writeFileSync } from 'node:fs';
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
        return {
          ...item,
          aiSuggestion: result.semanticToken || null,
          explanation: result.explanation,
          confidence: result.confidence,
        };
      }),
    );
    return { items: enriched, warning: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { items, warning: `AI explanations unavailable: ${message}\n` };
  }
}

/** The token to substitute for a finding, preferring an LLM recommendation. */
function fixReplacement(item: DriftItem): string | null {
  return item.aiSuggestion ?? item.suggestion;
}

/**
 * Rewrite drift in place using the AST-safe transformer. In `--dry-run` mode
 * the unified diffs are collected for stdout and no file is touched; otherwise
 * the fixed source is written back. The transformer re-parses every rewrite and
 * refuses to persist any file whose fix would produce invalid syntax. The
 * transformer (and its `magic-string`/`diff` deps) is imported lazily so a
 * plain scan never loads it.
 */
async function applyFixesToFiles(items: DriftItem[], dryRun: boolean): Promise<ScanOutcome> {
  const { applyFixes } = await import('../transformer/applyFixes.js');
  const { generateDiff } = await import('../transformer/generateDiff.js');

  const byFile = new Map<string, DriftItem[]>();
  for (const item of items) {
    const list = byFile.get(item.file) ?? [];
    list.push(item);
    byFile.set(item.file, list);
  }

  let diffOut = '';
  const warnings: string[] = [];
  let fixedFindings = 0;
  let fixedFiles = 0;

  for (const [file, fileItems] of byFile) {
    const targets = fileItems
      .map((item) => ({ item, replacement: fixReplacement(item) }))
      .filter((entry) => entry.replacement !== null)
      .map(({ item, replacement }) => ({
        type: item.type,
        value: item.value,
        replacement: replacement as string,
      }));
    if (targets.length === 0) continue;

    const before = readFileSync(file, 'utf8');
    const result = applyFixes(before, targets);
    if (!result.valid) {
      const detail = result.error ? ` (${result.error})` : '';
      warnings.push(`Skipped ${file}: fix produced invalid syntax${detail}\n`);
      continue;
    }
    if (result.applied === 0) continue;

    if (dryRun) {
      diffOut += generateDiff(file, before, result.code);
    } else {
      writeFileSync(file, result.code, 'utf8');
    }
    fixedFindings += result.applied;
    fixedFiles += 1;
  }

  const warning = warnings.join('');
  if (dryRun) {
    return { stdout: diffOut, stderr: warning, exitCode: 0 };
  }
  return {
    stdout: '',
    stderr: `${warning}Fixed ${fixedFindings} finding(s) across ${fixedFiles} file(s)\n`,
    exitCode: 0,
  };
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

  // The console formats surface explanations, and `--fix` uses the LLM's
  // recommended token; both need the AI round-trip. json/sarif reports without
  // a fix skip it entirely.
  const consoleFormat = config.format === 'console' || config.format === 'pretty';
  let aiWarning = '';
  if (config.ai.enabled && (consoleFormat || options.fix)) {
    const enriched = await enrichWithAi(items, matcher, config.ai);
    items = enriched.items;
    aiWarning = enriched.warning;
  }

  // `--fix` rewrites the source instead of rendering a report.
  if (options.fix) {
    const outcome = await applyFixesToFiles(items, options.dryRun ?? false);
    return { ...outcome, stderr: `${aiWarning}${outcome.stderr}` };
  }

  const report = render(items, config.format);
  const exitCode = config.failOnDrift && items.length > config.maxDrift ? 1 : 0;

  if (config.out) {
    writeReport(config.out, report);
    return { stdout: '', stderr: `${aiWarning}Report written to ${config.out}\n`, exitCode };
  }
  return { stdout: report, stderr: aiWarning, exitCode };
}
