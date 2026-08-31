import { loadTokens } from '../matcher/schema.js';
import { TokenMatcher } from '../matcher/tokenMatcher.js';
import type { DriftItem } from '../reporter/types.js';
import { scanFile, type Finding } from './astScanner.js';
import { defaultPoolSize, runScanPool, type ScanError } from './workerPool.js';

export type { ScanError } from './workerPool.js';
export { defaultPoolSize, warmScannerPool, shutdownScannerPools } from './workerPool.js';

export interface ScanEngineResult {
  items: DriftItem[];
  errors: ScanError[];
}

export interface ScanEngineOptions {
  /** Cap on concurrent workers for the parallel strategy. */
  maxWorkers?: number;
  /**
   * Force a strategy. When omitted, the engine scans in-process for small file
   * counts and fans out to a worker pool once the set is large enough to
   * outweigh the pool's start-up cost.
   */
  parallel?: boolean;
}

/**
 * File-count threshold above which parallel scanning pays for itself. Below it,
 * spawning workers (and their AST toolchain import) costs more than it saves.
 */
export const PARALLEL_THRESHOLD = 200;

/** Look up the closest design-system token to suggest for a finding. */
function suggestToken(matcher: TokenMatcher, finding: Finding): string | null {
  return finding.type === 'hardcoded-color'
    ? matcher.matchColor(finding.value).matchedToken
    : matcher.matchClass(finding.value).matchedToken;
}

/**
 * Scan every file in-process on the main thread. A file that fails to parse is
 * captured in `errors`, mirroring the worker pool so both strategies are
 * drop-in interchangeable.
 */
export function scanSequential(files: string[], tokensPath: string): ScanEngineResult {
  const matcher = new TokenMatcher(loadTokens(tokensPath));
  const items: DriftItem[] = [];
  const errors: ScanError[] = [];

  for (const file of files) {
    try {
      for (const finding of scanFile(file)) {
        items.push({
          file,
          line: finding.line,
          type: finding.type,
          value: finding.value,
          suggestion: suggestToken(matcher, finding),
        });
      }
    } catch (error) {
      errors.push({
        filePath: file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { items, errors };
}

/**
 * Scan every file across a pool of worker threads (AST parsing happens off the
 * main thread) and fold in token suggestions on the main thread. Token matching
 * is cheap and shared, so keeping it here spares each worker the color-math
 * import and keeps worker start-up fast.
 */
export async function scanParallel(
  files: string[],
  tokensPath: string,
  options: { maxWorkers?: number } = {},
): Promise<ScanEngineResult> {
  const matcher = new TokenMatcher(loadTokens(tokensPath));
  const { findings, errors } = await runScanPool(files, { maxWorkers: options.maxWorkers });
  const items: DriftItem[] = findings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    type: finding.type,
    value: finding.value,
    suggestion: suggestToken(matcher, finding),
  }));
  return { items, errors };
}

/**
 * Scan `files`, picking the single-threaded or parallel strategy automatically
 * (unless `parallel` is set explicitly). Both strategies return the same shape,
 * so callers are agnostic to which one ran.
 */
export function scanEngine(
  files: string[],
  tokensPath: string,
  options: ScanEngineOptions = {},
): Promise<ScanEngineResult> {
  const useParallel =
    options.parallel ?? (files.length >= PARALLEL_THRESHOLD && defaultPoolSize() > 1);
  return useParallel
    ? scanParallel(files, tokensPath, { maxWorkers: options.maxWorkers })
    : Promise.resolve(scanSequential(files, tokensPath));
}
