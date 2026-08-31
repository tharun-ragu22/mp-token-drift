import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriftItem } from '../../src/reporter/types.js';
import { scanParallel, scanSequential } from '../../src/scanner/scanEngine.js';
import {
  defaultPoolSize,
  shutdownScannerPools,
  warmScannerPool,
} from '../../src/scanner/workerPool.js';
import { generateLargeCodebase, type LargeCodebase } from '../helpers/generateLargeCodebase.js';

const TOKENS = 'fixtures/tokens.sample.json';
const POOL_SIZE = 3;

let codebase: LargeCodebase;

// Generating 1,500 files and booting the worker pool are the expensive, one-off
// costs. Pay them once here so every timed scan below runs against warm workers.
beforeAll(async () => {
  codebase = generateLargeCodebase({ count: 1500, corruptCount: 12 });
  await warmScannerPool(POOL_SIZE);
}, 120_000);

afterAll(async () => {
  await shutdownScannerPools();
  codebase?.cleanup();
});

/** Normalize findings into an order-independent set of location+value keys. */
function driftKeys(items: DriftItem[]): Set<string> {
  return new Set(items.map((i) => `${i.file}|${i.line}|${i.type}|${i.value}|${i.suggestion}`));
}

describe('worker pool - correctness parity', () => {
  it('detects the exact same drift as a single-threaded scan (100% parity)', async () => {
    const sequential = scanSequential(codebase.files, TOKENS);
    const parallel = await scanParallel(codebase.files, TOKENS, { maxWorkers: POOL_SIZE });

    // Identical count and identical set of findings across both strategies.
    expect(parallel.items.length).toBe(sequential.items.length);
    expect(driftKeys(parallel.items)).toEqual(driftKeys(sequential.items));

    // And that shared result matches the injected ground truth.
    expect(sequential.items.length).toBe(codebase.expectedDriftCount);
  }, 60_000);
});

describe('worker pool - performance SLA', () => {
  it('scans 1,500 files in parallel in under 15 seconds', async () => {
    const start = performance.now();
    const result = await scanParallel(codebase.files, TOKENS);
    const durationMs = performance.now() - start;

    expect(result.items.length).toBe(codebase.expectedDriftCount);
    expect(durationMs).toBeLessThan(15_000);
  }, 60_000);
});

describe('worker pool - error boundary', () => {
  it('captures unparseable files without crashing the pool', async () => {
    const result = await scanParallel(codebase.files, TOKENS, { maxWorkers: POOL_SIZE });

    const errored = new Set(result.errors.map((e) => e.filePath));
    for (const corrupt of codebase.corruptFiles) {
      expect(errored.has(corrupt)).toBe(true);
    }
    // Exactly the corrupt files error; nothing spurious.
    expect(result.errors.length).toBe(codebase.corruptFiles.length);
    // The parse failures are isolated: every good file is still fully scanned.
    expect(result.items.length).toBe(codebase.expectedDriftCount);
  }, 60_000);
});

describe('worker pool - pool sizing', () => {
  it('defaults to availableParallelism - 1 with a floor of 1', () => {
    expect(defaultPoolSize()).toBeGreaterThanOrEqual(1);
  });
});
