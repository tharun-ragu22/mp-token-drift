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

describe('TokenMatcher - color format variations', () => {
  it('matches short-hand hex #fff to white with Delta-E 0', () => {
    const result = matcher.matchColor('#fff');
    expect(result.matchedToken).toBe('white');
    expect(result.deltaE).toBe(0);
  });

  it('matches an rgba() literal to brand-primary', () => {
    const result = matcher.matchColor('rgba(26, 115, 232, 1)');
    expect(result.matchedToken).toBe('brand-primary');
  });
});

describe('TokenMatcher - color utility classes with prefixes', () => {
  it('suggests bg-brand-primary for bg-[#1a73e9]', () => {
    const result = matcher.matchClass('bg-[#1a73e9]');
    expect(result.matchedToken).toBe('bg-brand-primary');
  });

  it('suggests text-brand-secondary for text-[#188039]', () => {
    const result = matcher.matchClass('text-[#188039]');
    expect(result.matchedToken).toBe('text-brand-secondary');
  });

  it('suggests border-danger for border-[#d93026]', () => {
    const result = matcher.matchClass('border-[#d93026]');
    expect(result.matchedToken).toBe('border-danger');
  });
});

describe('TokenMatcher - non-pixel dimension units', () => {
  it('converts 0.75rem (12px) and matches p-3', () => {
    const result = matcher.matchClass('p-[0.75rem]');
    expect(result.matchedToken).toBe('p-3');
  });

  it('converts 1.25rem (20px) and matches p-5', () => {
    const result = matcher.matchClass('p-[1.25rem]');
    expect(result.matchedToken).toBe('p-5');
  });
});

describe('TokenMatcher - exact-match color bypass', () => {
  it('returns brand-primary with Delta-E 0 for an exact token color', () => {
    const result = matcher.matchColor('#1a73e8');
    expect(result.matchedToken).toBe('brand-primary');
    expect(result.deltaE).toBe(0);
  });
});

describe('TokenMatcher - negative utility offsets', () => {
  it('matches negative rem spacing -m-[0.75rem] to -m-3', () => {
    const result = matcher.matchClass('-m-[0.75rem]');
    expect(result.matchedToken).toBe('-m-3');
  });

  it('matches negative pixel offset -top-[13px] to -top-3', () => {
    const result = matcher.matchClass('-top-[13px]');
    expect(result.matchedToken).toBe('-top-3');
  });
});

describe('TokenMatcher - invalid and non-matching inputs', () => {
  it('returns null for a standard non-arbitrary class', () => {
    expect(matcher.matchClass('flex-col').matchedToken).toBeNull();
  });

  it('returns null for an unparseable color string', () => {
    expect(matcher.matchColor('not-a-color').matchedToken).toBeNull();
  });

  it('returns null for an empty arbitrary value', () => {
    expect(matcher.matchClass('p-[]').matchedToken).toBeNull();
  });

  it('returns null when a valid dimension class is beyond the pixel threshold', () => {
    // 100px is far from every spacing token (max 32px), so nothing is close enough.
    expect(matcher.matchClass('p-[100px]').matchedToken).toBeNull();
  });

  it('returns null when a valid color class is beyond the Delta-E threshold', () => {
    // No token is perceptually near magenta, so the prefixed suggestion is null.
    expect(matcher.matchClass('bg-[#ff00ff]').matchedToken).toBeNull();
  });
});

describe('TokenMatcher - candidate tokens (LLM choices)', () => {
  it('offers bare color-token names for an inline color', () => {
    const candidates = matcher.candidatesFor('#1a73e9');
    expect(candidates).toContain('brand-primary'); // the correct match is present
    expect(candidates).toEqual(
      expect.arrayContaining(['brand-primary', 'danger', 'neutral-900', 'white']),
    );
    expect(candidates).not.toContain('p-3'); // no scale utilities for a color
  });

  it('offers prefixed spacing utilities for an arbitrary spacing class', () => {
    const candidates = matcher.candidatesFor('p-[13px]');
    expect(candidates).toContain('p-3'); // the correct match is present
    expect(candidates.every((c) => c.startsWith('p-'))).toBe(true);
  });

  it('offers prefixed radius utilities for an arbitrary radius class', () => {
    const candidates = matcher.candidatesFor('rounded-[7px]');
    expect(candidates).toContain('rounded-md');
    expect(candidates).toContain('rounded-full');
    expect(candidates.every((c) => c.startsWith('rounded-'))).toBe(true);
  });

  it('offers prefixed color utilities for an arbitrary color class', () => {
    const candidates = matcher.candidatesFor('bg-[#1a73e9]');
    expect(candidates).toContain('bg-brand-primary'); // the correct match is present
    expect(candidates.every((c) => c.startsWith('bg-'))).toBe(true);
  });
});
