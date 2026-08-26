import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/index.js';

const SAMPLE = 'fixtures/sample-app';
const TOKENS = 'fixtures/tokens.sample.json';
const BAD_CARD = `${SAMPLE}/BadCard.tsx`;

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
