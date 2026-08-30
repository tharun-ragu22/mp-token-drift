import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTION_INPUT_NAMES,
  SARIF_OUTPUT_PATH,
  buildScanArgs,
} from '../../src/ci/actionFlags.js';
import { computeCacheKey } from '../../src/ci/cacheKey.js';
import { run } from '../../src/cli/index.js';

const TOKENS = 'fixtures/tokens.sample.json';
const BAD_CARD = 'fixtures/sample-app/BadCard.tsx';

/** Read the composite action manifest from the repo root. */
function readActionYml(): string {
  return readFileSync('action.yml', 'utf8');
}

/** Temp dirs created during a test, cleaned up afterwards. */
const tmpDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ci-action-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('CI action - CLI flag generation', () => {
  it('maps a full input set to mp-token-drift scan flags', () => {
    const args = buildScanArgs({
      tokens: 'tokens.json',
      config: 'drift.config.json',
      format: 'sarif',
      output: 'code-scanning.sarif',
      failOnDrift: true,
      maxDrift: '0',
      enableAi: true,
    });

    // The sub-command is always first.
    expect(args[0]).toBe('scan');
    // Each input is threaded through to its matching CLI flag.
    expect(args).toEqual(expect.arrayContaining(['--tokens', 'tokens.json']));
    expect(args).toEqual(expect.arrayContaining(['--config', 'drift.config.json']));
    expect(args).toEqual(expect.arrayContaining(['--format', 'sarif']));
    expect(args).toEqual(expect.arrayContaining(['--out', 'code-scanning.sarif']));
    expect(args).toEqual(expect.arrayContaining(['--max-drift', '0']));
    expect(args).toContain('--fail-on-drift');
    expect(args).toContain('--enable-ai');
  });

  it('omits flags whose inputs are empty, unset, or false', () => {
    const args = buildScanArgs({
      tokens: '',
      format: 'json',
      failOnDrift: false,
      enableAi: false,
    });

    expect(args).toEqual(['scan', '--format', 'json']);
    expect(args).not.toContain('--tokens');
    expect(args).not.toContain('--fail-on-drift');
    expect(args).not.toContain('--enable-ai');
  });

  it('splits the patterns input into positional args right after scan', () => {
    const args = buildScanArgs({
      patterns: 'src/**/*.tsx   components/**/*.tsx\napp/**/*.tsx',
      format: 'sarif',
    });

    // Whitespace-separated globs become positional arguments, in order.
    expect(args.slice(0, 4)).toEqual([
      'scan',
      'src/**/*.tsx',
      'components/**/*.tsx',
      'app/**/*.tsx',
    ]);
    expect(args).toEqual(expect.arrayContaining(['--format', 'sarif']));
  });

  it('produces args the scan command actually accepts end-to-end', async () => {
    const args = buildScanArgs({
      patterns: BAD_CARD,
      tokens: TOKENS,
      format: 'json',
    });

    const res = await run(args);
    expect(res.exitCode).toBe(0);

    const report = JSON.parse(res.stdout) as { findings: unknown[]; summary: { total: number } };
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.total).toBe(report.findings.length);
  });
});

describe('CI action - action.yml composite manifest', () => {
  it('declares every input the flag builder supports', () => {
    const yml = readActionYml();
    for (const name of ACTION_INPUT_NAMES) {
      // Each input is a two-space-indented key under the `inputs:` block.
      expect(yml).toMatch(new RegExp(`^ {2}${name}:`, 'm'));
    }
  });

  it('is a composite action that runs mp-token-drift scan', () => {
    const yml = readActionYml();
    expect(yml).toMatch(/using:\s*['"]?composite['"]?/);
    expect(yml).toContain('mp-token-drift scan');
  });

  it('uploads the SARIF report to GitHub Code Scanning', () => {
    const yml = readActionYml();
    expect(yml).toContain('github/codeql-action/upload-sarif');
    // The default SARIF artifact is the one uploaded to code scanning.
    expect(yml).toContain(SARIF_OUTPUT_PATH);
  });
});

describe('CI action - SARIF for GitHub Code Scanning', () => {
  it('names the default code scanning artifact code-scanning.sarif', () => {
    expect(SARIF_OUTPUT_PATH).toBe('code-scanning.sarif');
  });

  it('emits repository-relative artifact paths compatible with code scanning', async () => {
    const out = join(makeTempDir(), SARIF_OUTPUT_PATH);

    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'sarif', '--out', out]);
    expect(res.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);

    const sarif = JSON.parse(readFileSync(out, 'utf8')) as {
      runs: {
        results: {
          locations: { physicalLocation: { artifactLocation: { uri: string } } }[];
        }[];
      }[];
    };

    const uris = (sarif.runs[0]?.results ?? []).map(
      (r) => r.locations[0]?.physicalLocation.artifactLocation.uri ?? '',
    );
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) {
      // Code scanning resolves URIs against the repo root: they must be
      // relative, never absolute POSIX or Windows paths.
      expect(uri.startsWith('/')).toBe(false);
      expect(uri).not.toMatch(/^[A-Za-z]:[\\/]/);
      expect(uri).toContain('BadCard.tsx');
    }
  });
});

describe('CI action - computeCacheKey', () => {
  /** Write a config + tokens pair into a fresh temp dir and return their paths. */
  function writePair(configBody: string, tokensBody: string): { config: string; tokens: string } {
    const dir = makeTempDir();
    const config = join(dir, 'drift.config.json');
    const tokens = join(dir, 'tokens.json');
    writeFileSync(config, configBody);
    writeFileSync(tokens, tokensBody);
    return { config, tokens };
  }

  it('hashes config + token schema files into a deterministic key', () => {
    const { config, tokens } = writePair('{"maxDrift":0}', JSON.stringify({ colors: {} }));

    const first = computeCacheKey(config, tokens);
    const second = computeCacheKey(config, tokens);

    expect(first).toBe(second);
    expect(first).toMatch(/^mp-token-drift-[0-9a-f]{16,}$/);
  });

  it('changes the key when the config content changes', () => {
    const { config, tokens } = writePair('{"maxDrift":0}', JSON.stringify({ colors: {} }));
    const before = computeCacheKey(config, tokens);

    writeFileSync(config, '{"maxDrift":5}');
    const after = computeCacheKey(config, tokens);

    expect(after).not.toBe(before);
  });

  it('changes the key when the token schema content changes', () => {
    const { config, tokens } = writePair('{"maxDrift":0}', JSON.stringify({ colors: {} }));
    const before = computeCacheKey(config, tokens);

    writeFileSync(tokens, JSON.stringify({ colors: { brand: '#000000' } }));
    const after = computeCacheKey(config, tokens);

    expect(after).not.toBe(before);
  });

  it('distinguishes which file changed (content is not order-collapsed)', () => {
    const swappedA = writePair('A', 'B');
    const swappedB = writePair('B', 'A');

    // Swapping the bodies between the two files must not collide.
    expect(computeCacheKey(swappedA.config, swappedA.tokens)).not.toBe(
      computeCacheKey(swappedB.config, swappedB.tokens),
    );
  });

  it('throws when a hashed file is missing', () => {
    expect(() => computeCacheKey('does-not-exist.json', 'also-missing.json')).toThrow();
  });
});
