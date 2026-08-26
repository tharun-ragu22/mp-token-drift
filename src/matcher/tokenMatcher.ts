import { differenceCiede2000, parse as parseColor } from 'culori';
import type { TokenSet } from './schema.js';

export interface ColorMatch {
  /** Name of the closest color token, or null when none is within threshold. */
  matchedToken: string | null;
  /** CIEDE2000 perceptual distance to the closest token color. */
  deltaE: number;
}

export interface ClassMatch {
  /** Suggested standard Tailwind class, or null when none is within threshold. */
  matchedToken: string | null;
  /** Absolute pixel distance to the closest scale token, or null if unparseable. */
  distance: number | null;
}

export interface MatcherOptions {
  /** Max CIEDE2000 distance for a color to count as a match (default 10). */
  colorThreshold?: number;
  /** Max pixel distance for a dimension to count as a match (default 4). */
  dimensionThreshold?: number;
}

const DEFAULT_COLOR_THRESHOLD = 10;
const DEFAULT_DIMENSION_THRESHOLD = 4;

// Tailwind arbitrary-value class, e.g. `p-[13px]`, `rounded-[7px]`, `-mt-[3px]`.
const ARBITRARY_CLASS = /^(-?[a-z][a-z-]*)-\[(.+)\]$/;

const deltaE2000 = differenceCiede2000();

/** Convert a CSS length (`12px`, `1.5rem`) to pixels; null if not a length. */
function toPixels(value: string): number | null {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const magnitude = Number(match[1]);
  if (Number.isNaN(magnitude)) return null;
  const unit = match[2] ?? 'px';
  return unit === 'px' ? magnitude : magnitude * 16;
}

/**
 * Maps drift values (hardcoded colors, arbitrary Tailwind classes) back to the
 * closest design-system token, so callers can suggest a standard replacement.
 */
export class TokenMatcher {
  private readonly colorThreshold: number;
  private readonly dimensionThreshold: number;

  constructor(
    private readonly tokens: TokenSet,
    options: MatcherOptions = {},
  ) {
    this.colorThreshold = options.colorThreshold ?? DEFAULT_COLOR_THRESHOLD;
    this.dimensionThreshold = options.dimensionThreshold ?? DEFAULT_DIMENSION_THRESHOLD;
  }

  /** Find the perceptually closest color token to a raw color string. */
  matchColor(input: string): ColorMatch {
    if (!parseColor(input)) {
      return { matchedToken: null, deltaE: Infinity };
    }

    let best: string | null = null;
    let bestDelta = Infinity;
    for (const [name, value] of Object.entries(this.tokens.colors)) {
      const delta = deltaE2000(input, value);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = name;
      }
    }

    return {
      matchedToken: bestDelta <= this.colorThreshold ? best : null,
      deltaE: bestDelta,
    };
  }

  /** Suggest the standard Tailwind class closest to an arbitrary-value class. */
  matchClass(input: string): ClassMatch {
    const parsed = ARBITRARY_CLASS.exec(input);
    const prefix = parsed?.[1];
    const rawValue = parsed?.[2];
    if (prefix === undefined || rawValue === undefined) {
      return { matchedToken: null, distance: null };
    }

    const target = toPixels(rawValue);
    if (target === null) {
      return { matchedToken: null, distance: null };
    }

    const scale = prefix.startsWith('rounded') ? this.tokens.radius : this.tokens.spacing;
    let bestKey: string | null = null;
    let bestDistance = Infinity;
    for (const [key, value] of Object.entries(scale)) {
      const tokenPx = toPixels(value);
      if (tokenPx === null) continue;
      const distance = Math.abs(target - tokenPx);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }

    if (bestKey === null || bestDistance > this.dimensionThreshold) {
      return { matchedToken: null, distance: bestKey === null ? null : bestDistance };
    }
    return { matchedToken: `${prefix}-${bestKey}`, distance: bestDistance };
  }
}
