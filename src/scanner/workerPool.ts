import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Finding } from './astScanner.js';
import type { ScannerWorkerReady, ScannerWorkerResult } from './scannerWorker.js';

/** A raw finding tagged with the file it came from. */
export type PoolFinding = Finding & { file: string };

/** A file that could not be scanned, paired with the reason. */
export interface ScanError {
  filePath: string;
  error: string;
}

export interface PoolRunResult {
  findings: PoolFinding[];
  errors: ScanError[];
}

/**
 * Default worker count: one fewer than the available cores (leaving the main
 * thread a core), with a floor of one so single-core hosts still work.
 */
export function defaultPoolSize(): number {
  return Math.max(1, availableParallelism() - 1);
}

// Whether this module is running from TypeScript source (vitest/ts-node) rather
// than a compiled `dist` build. Determines how the worker entry is loaded.
const RUNNING_FROM_TS = import.meta.url.endsWith('.ts');
const workerHref = new URL(
  RUNNING_FROM_TS ? './scannerWorker.ts' : './scannerWorker.js',
  import.meta.url,
).href;

/**
 * Spawn a scanner worker. In a built `dist` the entry is plain `.js` and loads
 * directly. Under TypeScript (tests/dev) Node cannot load a `.ts` entry, so a
 * tiny JS bootstrap registers the tsx ESM loader and then dynamically imports
 * the real worker — the one reliable way to run a `.ts` worker on Node 20.
 */
function spawnWorker(): Worker {
  if (RUNNING_FROM_TS) {
    const bootstrap =
      `import { register } from 'tsx/esm/api';` +
      `register();` +
      `await import(${JSON.stringify(workerHref)});`;
    return new Worker(bootstrap, { eval: true });
  }
  return new Worker(new URL(workerHref));
}

/**
 * A long-lived pool of scanner workers. Importing the AST toolchain in a fresh
 * thread is expensive, so workers are booted once and reused across scans via a
 * job queue — never one worker per file. A file that fails to parse is recorded
 * in `errors` rather than aborting the run.
 */
class ScannerPool {
  private readonly workers: Worker[];
  private readonly readyPromise: Promise<void>;
  private onResult: ((worker: Worker, result: ScannerWorkerResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  constructor(readonly size: number) {
    let readyCount = 0;
    let resolveReady!: () => void;
    this.readyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });

    this.workers = Array.from({ length: size }, () => {
      const worker = spawnWorker();
      worker.on('message', (message: ScannerWorkerResult | ScannerWorkerReady) => {
        // Only the readiness signal carries a `type` field.
        if ('type' in message) {
          if (++readyCount === size) resolveReady();
          return;
        }
        this.onResult?.(worker, message);
      });
      worker.on('error', (error: Error) => this.onError?.(error));
      return worker;
    });
  }

  /** Resolves once every worker has finished importing and is ready for jobs. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Scan `files` across the pool, resolving with aggregated findings + errors. */
  run(files: string[]): Promise<PoolRunResult> {
    return new Promise<PoolRunResult>((resolve, reject) => {
      const findings: PoolFinding[] = [];
      const errors: ScanError[] = [];
      const total = files.length;
      if (total === 0) {
        resolve({ findings, errors });
        return;
      }

      let next = 0;
      let completed = 0;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.onResult = null;
        this.onError = null;
        resolve({ findings, errors });
      };

      this.onError = (error) => {
        if (settled) return;
        settled = true;
        this.onResult = null;
        this.onError = null;
        reject(error);
      };

      this.onResult = (worker, result) => {
        completed += 1;
        if (result.error) {
          errors.push({ filePath: result.filePath, error: result.error });
        } else {
          for (const finding of result.findings) {
            findings.push({ ...finding, file: result.filePath });
          }
        }
        if (next < total) worker.postMessage(files[next++]);
        if (completed === total) finish();
      };

      // Prime each worker with one job; the rest are pulled on completion.
      for (const worker of this.workers) {
        if (next < total) worker.postMessage(files[next++]);
      }
    });
  }

  destroy(): Promise<void> {
    return Promise.all(this.workers.map((worker) => worker.terminate())).then(() => undefined);
  }
}

// Pools are keyed by size so repeat scans at the same concurrency reuse warm
// workers instead of paying the import cost again.
const pools = new Map<number, ScannerPool>();

/** Get (creating if needed) the shared pool for a given worker count. */
export function getScannerPool(size: number): ScannerPool {
  let pool = pools.get(size);
  if (!pool) {
    pool = new ScannerPool(size);
    pools.set(size, pool);
  }
  return pool;
}

/** Pre-boot the pool for a given size so a later scan starts warm. */
export async function warmScannerPool(size: number = defaultPoolSize()): Promise<void> {
  await getScannerPool(size).ready();
}

/** Scan `files` across the shared pool of the requested (or default) size. */
export function runScanPool(
  files: string[],
  options: { maxWorkers?: number } = {},
): Promise<PoolRunResult> {
  const size = Math.max(1, options.maxWorkers ?? defaultPoolSize());
  return getScannerPool(size).run(files);
}

/** Terminate every pooled worker and clear the cache (call on shutdown/teardown). */
export async function shutdownScannerPools(): Promise<void> {
  const active = [...pools.values()];
  pools.clear();
  await Promise.all(active.map((pool) => pool.destroy()));
}
