import { describe, expect, it } from 'vitest';
import { loadTokens } from '../src/matcher/schema.js';
import { TokenMatcher } from '../src/matcher/tokenMatcher.js';

const tokens = loadTokens('fixtures/tokens.sample.json');
const matcher = new TokenMatcher(tokens);

describe('TokenMatcher - color matching', () => {
  it('matches a near-identical hex #1a73e9 to brand-primary (#1a73e8) with Delta-E < 1.0', () => {
    const result = matcher.matchColor('#1a73e9');
    expect(result.matchedToken).toBe('brand-primary');
    expect(result.deltaE).toBeLessThan(1.0);
  });

  it('returns matchedToken null when the nearest color is beyond the Delta-E threshold (> 15)', () => {
    const result = matcher.matchColor('#ff00ff');
    expect(result.deltaE).toBeGreaterThan(15);
    expect(result.matchedToken).toBeNull();
  });
});

describe('TokenMatcher - dimension class matching', () => {
  it('matches arbitrary spacing class p-[13px] to the standard token p-3 (12px)', () => {
    const result = matcher.matchClass('p-[13px]');
    expect(result.matchedToken).toBe('p-3');
  });

  it('matches arbitrary radius class rounded-[7px] to rounded-md (8px)', () => {
    const result = matcher.matchClass('rounded-[7px]');
    expect(result.matchedToken).toBe('rounded-md');
  });
});
