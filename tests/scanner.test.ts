import { describe, expect, it } from 'vitest';
import { scanFile } from '../src/scanner/astScanner.js';

describe('astScanner', () => {
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
