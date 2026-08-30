import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyFixes, applyFixesToFile, type FixTarget } from '../../src/transformer/applyFixes.js';
import { generateDiff } from '../../src/transformer/generateDiff.js';
import { run } from '../../src/cli/index.js';

const TOKENS = 'fixtures/tokens.sample.json';
const DRIFTY =
  'const el = <div className="p-[13px]"><span style={{ color: "#1a73e8" }} /></div>;\n';

/** A temp .tsx file inside the repo so relative globs resolve against cwd. */
function makeRepoFixture(contents: string): string {
  const dir = mkdtempSync(join(process.cwd(), 'autofix-cli-'));
  tmpDirs.push(dir);
  const file = join(dir, 'Drifty.tsx');
  writeFileSync(file, contents, 'utf8');
  // Return a cwd-relative path so the scan's glob matches it.
  return file.slice(process.cwd().length + 1);
}

/** Temp dirs created during a test, cleaned up afterwards. */
const tmpDirs: string[] = [];

function makeTempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'autofix-'));
  tmpDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('applyFixes - inline raw styles', () => {
  it('replaces a hardcoded color literal with a semantic token reference', () => {
    const code = 'const el = <span style={{ color: "#1a73e8" }}>Hi</span>;\n';
    const targets: FixTarget[] = [
      { type: 'hardcoded-color', value: '#1a73e8', replacement: 'brand-primary' },
    ];

    const result = applyFixes(code, targets);

    expect(result.valid).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.code).toContain('style={{ color: tokens.color.brand.primary }}');
    expect(result.code).not.toContain('#1a73e8');
  });
});

describe('applyFixes - Tailwind arbitrary utilities', () => {
  it('replaces an arbitrary class inside a className string with the scale token', () => {
    const code = 'const el = <div className="p-[13px] rounded shadow" />;\n';
    const targets: FixTarget[] = [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p-3' },
    ];

    const result = applyFixes(code, targets);

    expect(result.valid).toBe(true);
    expect(result.applied).toBe(1);
    // Only the drifting token changes; sibling classes are preserved verbatim.
    expect(result.code).toContain('className="p-3 rounded shadow"');
    expect(result.code).not.toContain('p-[13px]');
  });
});

describe('applyFixes - preserves comments, formatting and sibling attributes', () => {
  it('rewrites only the drift ranges and leaves everything else byte-for-byte', () => {
    const code = [
      '// leading comment',
      'const el = (',
      '  <button',
      '    id="save"',
      '    className="p-[13px] font-bold"',
      '    style={{ color: "#1a73e8" }}',
      '    data-testid="btn"',
      '  >',
      '    Save {/* inline comment */}',
      '  </button>',
      ');',
      '',
    ].join('\n');
    const targets: FixTarget[] = [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p-3' },
      { type: 'hardcoded-color', value: '#1a73e8', replacement: 'brand-primary' },
    ];

    const result = applyFixes(code, targets);

    expect(result.valid).toBe(true);
    expect(result.applied).toBe(2);
    // Comments survive.
    expect(result.code).toContain('// leading comment');
    expect(result.code).toContain('{/* inline comment */}');
    // Sibling attributes and their indentation survive.
    expect(result.code).toContain('    id="save"');
    expect(result.code).toContain('    data-testid="btn"');
    // Both drift sites are rewritten.
    expect(result.code).toContain('className="p-3 font-bold"');
    expect(result.code).toContain('style={{ color: tokens.color.brand.primary }}');
  });
});

describe('generateDiff - dry-run rendering', () => {
  it('produces a unified git-style diff without touching the file on disk', () => {
    const original = 'const el = <div className="p-[13px]" />;\n';
    const file = makeTempFile('Card.tsx', original);

    const before = readFileSync(file, 'utf8');
    const after = applyFixes(before, [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p-3' },
    ]).code;

    const diff = generateDiff(file, before, after);

    // Unified-diff headers and +/- hunk lines.
    expect(diff).toMatch(/^---/m);
    expect(diff).toMatch(/^\+\+\+/m);
    expect(diff).toContain('-const el = <div className="p-[13px]" />;');
    expect(diff).toContain('+const el = <div className="p-3" />;');

    // Dry-run must never write: the file is byte-for-byte unchanged.
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
});

describe('applyFixes - re-parse safety gate', () => {
  it('flags output that no longer parses as invalid', () => {
    const code = 'const el = <div className="p-[13px]" />;\n';
    // A replacement containing a quote would break the enclosing JSX string.
    const result = applyFixes(code, [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p"3' },
    ]);

    expect(result.valid).toBe(false);
  });

  it('aborts the disk write when the transformed source is invalid', () => {
    const original = 'const el = <div className="p-[13px]" />;\n';
    const file = makeTempFile('Broken.tsx', original);

    const result = applyFixesToFile(file, [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p"3' },
    ]);

    expect(result.valid).toBe(false);
    // The safety gate must leave the original file completely intact.
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('writes the fixed source to disk when the transform is valid', () => {
    const original = 'const el = <div className="p-[13px]" />;\n';
    const file = makeTempFile('Good.tsx', original);

    const result = applyFixesToFile(file, [
      { type: 'arbitrary-class', value: 'p-[13px]', replacement: 'p-3' },
    ]);

    expect(result.valid).toBe(true);
    expect(result.applied).toBe(1);
    expect(readFileSync(file, 'utf8')).toContain('className="p-3" />');
  });
});

describe('CLI - scan --fix', () => {
  it('--dry-run prints a diff to stdout and leaves the file untouched', async () => {
    const relPath = makeRepoFixture(DRIFTY);

    const res = await run(['scan', relPath, '--tokens', TOKENS, '--fix', '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('+const el = <div className="p-3">');
    expect(res.stdout).toContain('tokens.color.brand.primary');
    // Dry-run never writes.
    expect(readFileSync(relPath, 'utf8')).toBe(DRIFTY);
  });

  it('--fix rewrites the file on disk with the design tokens', async () => {
    const relPath = makeRepoFixture(DRIFTY);

    const res = await run(['scan', relPath, '--tokens', TOKENS, '--fix']);

    expect(res.exitCode).toBe(0);
    const rewritten = readFileSync(relPath, 'utf8');
    expect(rewritten).toContain('className="p-3"');
    expect(rewritten).toContain('style={{ color: tokens.color.brand.primary }}');
    expect(rewritten).not.toContain('p-[13px]');
    expect(rewritten).not.toContain('#1a73e8');
  });
});
