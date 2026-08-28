import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/index.js';

const SAMPLE = 'fixtures/sample-app';
const TOKENS = 'fixtures/tokens.sample.json';
const BAD_CARD = `${SAMPLE}/BadCard.tsx`;
const CLEAN_CARD = `${SAMPLE}/CleanCard.tsx`;
const SUPPRESSED = `${SAMPLE}/Suppressed.tsx`;

const ANSI = /\u001b\[[0-9;]*m/;

/** Restore captured env vars, deleting those that were originally unset. */
function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('CLI - JSON reporter', () => {
  it('outputs valid structured JSON with findings', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'json']);
    expect(res.exitCode).toBe(0);

    const report = JSON.parse(res.stdout) as {
      findings: { file: string; line: number; type: string; value: string }[];
      summary: { total: number };
    };
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.total).toBe(report.findings.length);

    const first = report.findings[0];
    expect(first).toMatchObject({
      file: expect.stringContaining('BadCard.tsx') as unknown,
      line: expect.any(Number) as unknown,
      type: expect.any(String) as unknown,
      value: expect.any(String) as unknown,
    });
  });
});

describe('CLI - SARIF reporter', () => {
  it('outputs a valid SARIF v2.1.0 report', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'sarif']);
    expect(res.exitCode).toBe(0);

    const sarif = JSON.parse(res.stdout) as {
      $schema: string;
      version: string;
      runs: {
        tool: { driver: { name: string; rules: { id: string }[] } };
        results: {
          ruleId: string;
          level: string;
          locations: {
            physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
          }[];
        }[];
      }[];
    };

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0]?.tool.driver.name).toBe('mp-token-drift');
    expect(sarif.runs[0]?.results.length).toBeGreaterThan(0);

    const result = sarif.runs[0]?.results[0];
    expect(result?.ruleId).toBeTruthy();
    expect(result?.locations[0]?.physicalLocation.region.startLine).toBeGreaterThan(0);
    expect(result?.locations[0]?.physicalLocation.artifactLocation.uri).toContain('BadCard.tsx');
  });
});

describe('CLI - fail-on-drift threshold', () => {
  it('exits 1 when findings exceed --max-drift', async () => {
    const res = await run([
      'scan',
      BAD_CARD,
      '--tokens',
      TOKENS,
      '--fail-on-drift',
      '--max-drift',
      '0',
    ]);
    expect(res.exitCode).toBe(1);
  });

  it('exits 0 when findings are within --max-drift', async () => {
    const res = await run([
      'scan',
      BAD_CARD,
      '--tokens',
      TOKENS,
      '--fail-on-drift',
      '--max-drift',
      '10',
    ]);
    expect(res.exitCode).toBe(0);
  });
});

describe('CLI - ignore globs', () => {
  it('excludes files matching --ignore from the scan', async () => {
    const pattern = `${SAMPLE}/**/*.tsx`;
    const withTests = await run(['scan', pattern, '--tokens', TOKENS, '--format', 'json']);
    const withoutTests = await run([
      'scan',
      pattern,
      '--tokens',
      TOKENS,
      '--ignore',
      '**/*.test.tsx',
      '--format',
      'json',
    ]);

    const all = (JSON.parse(withTests.stdout) as { findings: { file: string }[] }).findings;
    const filtered = (JSON.parse(withoutTests.stdout) as { findings: { file: string }[] }).findings;

    expect(all.some((f) => f.file.endsWith('.test.tsx'))).toBe(true);
    expect(filtered.length).toBeLessThan(all.length);
    expect(filtered.every((f) => !f.file.endsWith('.test.tsx'))).toBe(true);
  });
});

describe('CLI - error handling', () => {
  it('exits 2 with a readable error when the tokens file is missing', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', 'fixtures/does-not-exist.json']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/not found/i);
  });

  it('exits 2 with a readable error when an explicit config file is missing', async () => {
    const res = await run(['scan', BAD_CARD, '--config', 'no-such.config.json']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/config/i);
  });
});

describe('CLI - file output (--out)', () => {
  it('writes the report to a file and keeps stdout free of the payload', async () => {
    const outPath = 'tmp/report.json';
    rmSync('tmp', { recursive: true, force: true });
    try {
      const res = await run([
        'scan',
        BAD_CARD,
        '--tokens',
        TOKENS,
        '--format',
        'json',
        '--out',
        outPath,
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).not.toContain('"findings"');
      expect(existsSync(outPath)).toBe(true);

      const report = JSON.parse(readFileSync(outPath, 'utf8')) as {
        findings: unknown[];
        summary: { total: number };
      };
      expect(report.summary.total).toBe(report.findings.length);
      expect(report.findings.length).toBeGreaterThan(0);
    } finally {
      rmSync('tmp', { recursive: true, force: true });
    }
  });
});

describe('CLI - stdout/stderr isolation', () => {
  it('emits only parseable JSON to stdout for --format json', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'json']);
    expect(res.stdout.trimStart().startsWith('{')).toBe(true);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
  });

  it('emits only parseable SARIF to stdout for --format sarif', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'sarif']);
    const sarif = JSON.parse(res.stdout) as { version: string };
    expect(sarif.version).toBe('2.1.0');
  });
});

describe('CLI - implicit config resolution', () => {
  it('auto-discovers drift.config.json in the root to resolve tokens', async () => {
    const configPath = 'drift.config.json';
    const existed = existsSync(configPath);
    const backup = existed ? readFileSync(configPath, 'utf8') : null;
    writeFileSync(configPath, JSON.stringify({ tokens: TOKENS }));
    try {
      const res = await run(['scan', BAD_CARD, '--format', 'json']);
      expect(res.exitCode).toBe(0);
      const report = JSON.parse(res.stdout) as { findings: unknown[] };
      expect(report.findings.length).toBeGreaterThan(0);
    } finally {
      if (backup !== null) writeFileSync(configPath, backup);
      else rmSync(configPath, { force: true });
    }
  });
});

describe('CLI - clean baseline scan', () => {
  it('reports zero findings for a drift-free component', async () => {
    const res = await run(['scan', CLEAN_CARD, '--tokens', TOKENS, '--format', 'json']);
    expect(res.exitCode).toBe(0);

    const report = JSON.parse(res.stdout) as { findings: unknown[]; summary: { total: number } };
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });
});

describe('CLI - pretty console output', () => {
  it('renders colorized, human-readable output with paths, lines, and suggestions', async () => {
    const saved = {
      CI: process.env.CI,
      NO_COLOR: process.env.NO_COLOR,
      FORCE_COLOR: process.env.FORCE_COLOR,
    };
    delete process.env.CI;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    try {
      const res = await run(['scan', BAD_CARD, '--tokens', TOKENS]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('BadCard.tsx');
      expect(res.stdout).toMatch(/:\d+/); // line numbers
      expect(res.stdout).toContain('brand-primary'); // human-readable suggestion
      expect(res.stdout).toMatch(ANSI); // colorized
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('CLI - CI color stripping', () => {
  it('strips ANSI color codes when CI is set', async () => {
    const saved = { CI: process.env.CI, NO_COLOR: process.env.NO_COLOR };
    process.env.CI = 'true';
    delete process.env.NO_COLOR;
    try {
      const res = await run(['scan', BAD_CARD, '--tokens', TOKENS]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('BadCard.tsx'); // content still present
      expect(res.stdout).not.toMatch(ANSI); // but no color codes
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('CLI - inline suppression directives', () => {
  it('skips findings preceded by a drift-ignore or drift-disable comment', async () => {
    const res = await run(['scan', SUPPRESSED, '--tokens', TOKENS, '--format', 'json']);
    expect(res.exitCode).toBe(0);

    const values = (JSON.parse(res.stdout) as { findings: { value: string }[] }).findings.map(
      (f) => f.value,
    );
    expect(values).not.toContain('#123456'); // preceding // drift-ignore
    expect(values).not.toContain('p-[99px]'); // preceding /* drift-disable */
    expect(values).toContain('#654321'); // no directive → still reported
  });
});

describe('CLI - malformed config', () => {
  it('exits 2 with a readable error when the config file is invalid JSON', async () => {
    const badPath = 'tmp-bad.config.json';
    writeFileSync(badPath, '{ "tokens": "x", }'); // trailing comma → invalid JSON
    try {
      const res = await run(['scan', BAD_CARD, '--config', badPath]);
      expect(res.exitCode).toBe(2);
      expect(res.stderr).toMatch(/config|json/i);
    } finally {
      rmSync(badPath, { force: true });
    }
  });
});

describe('CLI - unmatched glob patterns', () => {
  it('exits 0 with zero findings when the glob matches nothing', async () => {
    const res = await run([
      'scan',
      'non-existent-folder/**/*.tsx',
      '--tokens',
      TOKENS,
      '--format',
      'json',
    ]);
    expect(res.exitCode).toBe(0);

    const report = JSON.parse(res.stdout) as { findings: unknown[]; summary: { total: number } };
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });
});

describe('CLI - invalid parameters', () => {
  it('exits 2 for an unsupported --format value', async () => {
    const res = await run(['scan', BAD_CARD, '--tokens', TOKENS, '--format', 'invalid_format']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/format/i);
  });
});
