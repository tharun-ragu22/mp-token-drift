import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FindingType } from '../../src/scanner/astScanner.js';

/** One expected drift finding, keyed by the exact location the scanner reports. */
export interface DriftExpectation {
  file: string;
  line: number;
  type: FindingType;
  value: string;
}

/** A generated on-disk codebase plus ground-truth metadata about its drift. */
export interface LargeCodebase {
  /** Absolute path to the temporary root directory. */
  dir: string;
  /** Every generated `.tsx` file, absolute paths (drift + clean + corrupt). */
  files: string[];
  /** Files that contain exactly two injected drift violations. */
  driftFiles: string[];
  /** Files that use only valid tokens and must produce zero findings. */
  cleanFiles: string[];
  /** Files with deliberately unparseable syntax (the scanner must error, not crash). */
  corruptFiles: string[];
  /** Total findings across all non-corrupt files (`driftFiles.length * 2`). */
  expectedDriftCount: number;
  /** The exact (file, line, type, value) tuples the scanner should report. */
  expectedViolations: DriftExpectation[];
  /** Remove the temporary directory. */
  cleanup: () => void;
}

export interface GenerateOptions {
  /** Total number of files to generate (default 1500). */
  count?: number;
  /** How many of those files are deliberately corrupt (default 0). */
  corruptCount?: number;
}

/** A deterministic, always-flagged hex color for file `i` (never a no-op). */
function hexFor(i: number): string {
  const channel = (a: number, b: number): string =>
    ((i * a + b) % 256).toString(16).padStart(2, '0');
  return `#${channel(97, 13)}${channel(57, 7)}${channel(31, 3)}`;
}

/** A deterministic Tailwind arbitrary-value class for file `i`. */
function arbitraryClassFor(i: number): string {
  return `p-[${13 + (i % 20)}px]`;
}

/**
 * Build a realistic component that mixes valid token usage with two drift
 * violations, returning the source and the exact line each violation lands on.
 */
function driftComponent(i: number): { source: string; arbLine: number; hexLine: number } {
  const arb = arbitraryClassFor(i);
  const hex = hexFor(i);
  const lines = [
    `import React from 'react';`,
    `import { tokens } from './tokens';`,
    ``,
    `export function Component${i}({ label }: { label: string }) {`,
    `  return (`,
    `    <section className="p-3 rounded shadow-sm">`,
    `      <span style={{ color: tokens.color.brand.primary }}>{label}</span>`,
    `      <button className="${arb} font-bold">Action</button>`,
    `      <span style={{ color: '${hex}' }}>Legacy</span>`,
    `    </section>`,
    `  );`,
    `}`,
    ``,
  ];
  // 1-based line numbers of the two drift sites (array index + 1).
  return { source: lines.join('\n'), arbLine: 8, hexLine: 9 };
}

/** Build a fully valid component that produces no findings. */
function cleanComponent(i: number): string {
  return [
    `import React from 'react';`,
    `import { tokens } from './tokens';`,
    ``,
    `export function Component${i}({ label }: { label: string }) {`,
    `  return (`,
    `    <section className="p-2 rounded shadow-sm">`,
    `      <span style={{ color: tokens.color.brand.primary }}>{label}</span>`,
    `      <button className="p-4 font-bold">Action</button>`,
    `    </section>`,
    `  );`,
    `}`,
    ``,
  ].join('\n');
}

/** Deliberately unparseable TSX so the scanner must surface an error. */
function corruptComponent(i: number): string {
  return `export function Broken${i}( {\n  return <div className="p-[1px]"\n}\n`;
}

/**
 * Programmatically generate a large temporary TSX codebase for parallel-scan
 * benchmarking. Files interleave three kinds — drift, clean, and corrupt — and
 * the returned metadata pins the exact violations the scanner should find so a
 * parallel run can be checked for 100% parity against a single-threaded one.
 */
export function generateLargeCodebase(options: GenerateOptions = {}): LargeCodebase {
  const count = options.count ?? 1500;
  const corruptCount = options.corruptCount ?? 0;

  const dir = mkdtempSync(join(tmpdir(), 'mp-large-codebase-'));
  const files: string[] = [];
  const driftFiles: string[] = [];
  const cleanFiles: string[] = [];
  const corruptFiles: string[] = [];
  const expectedViolations: DriftExpectation[] = [];

  for (let i = 0; i < count; i++) {
    const file = join(dir, `Component${i}.tsx`);
    files.push(file);

    if (i < corruptCount) {
      writeFileSync(file, corruptComponent(i), 'utf8');
      corruptFiles.push(file);
      continue;
    }

    // Two-thirds of the non-corrupt files carry drift; the rest are clean.
    if (i % 3 !== 0) {
      const { source, arbLine, hexLine } = driftComponent(i);
      writeFileSync(file, source, 'utf8');
      driftFiles.push(file);
      expectedViolations.push(
        { file, line: arbLine, type: 'arbitrary-class', value: arbitraryClassFor(i) },
        { file, line: hexLine, type: 'hardcoded-color', value: hexFor(i) },
      );
    } else {
      writeFileSync(file, cleanComponent(i), 'utf8');
      cleanFiles.push(file);
    }
  }

  return {
    dir,
    files,
    driftFiles,
    cleanFiles,
    corruptFiles,
    expectedDriftCount: driftFiles.length * 2,
    expectedViolations,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
