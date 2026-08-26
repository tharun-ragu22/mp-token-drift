import { describe, expect, it } from 'vitest';
import { scanFile } from '../src/scanner/astScanner.js';

describe('astScanner - BadCard', () => {
  const findings = scanFile('fixtures/sample-app/BadCard.tsx');

  it('detects hardcoded inline hex color #1a73e8 on line 6', () => {
    const finding = findings.find((f) => f.type === 'hardcoded-color' && f.value === '#1a73e8');
    expect(finding).toBeDefined();
    expect(finding?.line).toBe(6);
  });

  it('detects arbitrary Tailwind class p-[13px] on line 5', () => {
    const finding = findings.find((f) => f.type === 'arbitrary-class' && f.value === 'p-[13px]');
    expect(finding).toBeDefined();
    expect(finding?.line).toBe(5);
  });
});

describe('astScanner - CleanCard', () => {
  it('returns an empty array for a drift-free component', () => {
    expect(scanFile('fixtures/sample-app/CleanCard.tsx')).toEqual([]);
  });
});

describe('astScanner - ComplexCard', () => {
  const findings = scanFile('fixtures/sample-app/ComplexCard.tsx');
  const arbitraryClasses = findings.filter((f) => f.type === 'arbitrary-class').map((f) => f.value);
  const colors = findings.filter((f) => f.type === 'hardcoded-color').map((f) => f.value);

  it('detects all 4 arbitrary Tailwind classes from a single className string', () => {
    for (const cls of ['p-[13px]', 'm-[7px]', 'bg-[#f0f0f0]', 'text-[15px]']) {
      expect(arbitraryClasses).toContain(cls);
    }
  });

  it('detects both camelCase inline style hardcoded colors (hex + rgb)', () => {
    expect(colors).toContain('#ffffff');
    expect(colors).toContain('rgb(26, 115, 232)');
  });

  it('detects arbitrary classes inside template literals', () => {
    expect(arbitraryClasses).toContain('px-[9px]');
    expect(arbitraryClasses).toContain('bg-[#1a73e8]');
    expect(arbitraryClasses).toContain('bg-[#000000]');
  });

  it('detects short-hand hex colors', () => {
    expect(colors).toContain('#f00');
  });
});

describe('astScanner - Edge Cases', () => {
  const findings = scanFile('fixtures/sample-app/EdgeCasesCard.tsx');
  const arbitraryClasses = findings.filter((f) => f.type === 'arbitrary-class').map((f) => f.value);
  const colors = findings.filter((f) => f.type === 'hardcoded-color').map((f) => f.value);

  it('flags modern color formats and CSS variable fallbacks as hardcoded colors', () => {
    expect(colors).toContain('rgba(0, 0, 0, 0.5)');
    expect(colors).toContain('hsl(210, 100%, 50%)');
    expect(colors).toContain('#ff0055');
  });

  it('detects arbitrary classes inside cn() and clsx() utility calls', () => {
    expect(arbitraryClasses).toContain('p-[12px]');
    expect(arbitraryClasses).toContain('m-[4px]');
    expect(arbitraryClasses).toContain('bg-[#123456]');
  });

  it('parses negative offsets and multi-word arbitrary values', () => {
    expect(arbitraryClasses).toContain('-top-[12px]');
    expect(arbitraryClasses).toContain('grid-cols-[1fr_2fr]');
  });

  it('throws a readable error when the file does not exist', () => {
    expect(() => scanFile('fixtures/non-existent.tsx')).toThrow(/File not found/);
  });

  it('detects OKLCH colors in inline styles and arbitrary classes', () => {
    expect(colors).toContain('oklch(0.6 0.25 140)');
    expect(arbitraryClasses).toContain('bg-[oklch(0.7_0.15_200)]');
  });

  it('captures both branches of a ternary in a style object', () => {
    expect(colors).toContain('#ff0000');
    expect(colors).toContain('rgba(0, 0, 0, 0.8)');
  });

  it('flags colors from an external style object constant', () => {
    expect(colors).toContain('#e5e7eb');
  });

  it('ignores findings on lines marked with a drift-ignore directive', () => {
    expect(colors).not.toContain('#00ff00');
  });
});
