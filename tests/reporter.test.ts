import { describe, expect, it } from 'vitest';
import { formatConsole } from '../src/reporter/consoleReporter.js';
import type { DriftItem } from '../src/reporter/types.js';

const ANSI = /\[[0-9;]*m/g;

/** Strip color codes so assertions read the plain text the user sees. */
function plain(text: string): string {
  return text.replace(ANSI, '');
}

const baseItem: DriftItem = {
  file: 'src/Card.tsx',
  line: 12,
  type: 'hardcoded-color',
  value: '#1a73e9',
  suggestion: 'brand-primary',
};

describe('console reporter - AI explanations', () => {
  it('prints the LLM explanation and confidence indented below the finding', () => {
    const output = plain(
      formatConsole([
        {
          ...baseItem,
          explanation: 'This blue matches the brand-primary token.',
          confidence: 0.92,
        },
      ]),
    );

    const lines = output.split('\n');
    expect(lines[0]).toContain('#1a73e9');
    expect(lines[0]).toContain('brand-primary');
    // The explanation lands on its own indented line beneath the finding.
    expect(lines[1]).toMatch(/^\s+↳ This blue matches the brand-primary token\./);
    expect(lines[1]).toContain('92% confidence');
  });

  it('omits the explanation line when no AI rationale is present', () => {
    const output = plain(formatConsole([baseItem]));
    expect(output).not.toContain('↳');
    expect(output.split('\n')[0]).toContain('#1a73e9');
  });
});
