import { parentPort } from 'node:worker_threads';
import { scanFile, type Finding } from './astScanner.js';

/** Posted once, when the worker has finished importing and is ready for jobs. */
export interface ScannerWorkerReady {
  type: 'ready';
}

/** The structured result posted back for every file the worker processes. */
export interface ScannerWorkerResult {
  filePath: string;
  findings: Finding[];
  /** Present only when the file could not be parsed. */
  error?: string;
}

if (!parentPort) {
  throw new Error('scannerWorker must be run as a worker thread');
}
const port = parentPort;

/**
 * Scan a single file and post back its raw findings. A parse failure is caught
 * and reported as a structured `error` so one bad file can never crash the
 * worker (and, with it, the whole pool). Token matching is intentionally left
 * to the main thread: workers stay CPU-focused on AST parsing and avoid loading
 * the color-math dependency, which keeps their start-up cost down.
 */
port.on('message', (filePath: string) => {
  try {
    const findings = scanFile(filePath);
    port.postMessage({ filePath, findings } satisfies ScannerWorkerResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.postMessage({ filePath, findings: [], error: message } satisfies ScannerWorkerResult);
  }
});

// Signal readiness only after the (slow) module graph has finished importing, so
// the pool can pre-warm workers before timing a scan.
port.postMessage({ type: 'ready' } satisfies ScannerWorkerReady);
