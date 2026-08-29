import {
  deltaE,
  nearestScalePoint,
  toPerceptualColor,
  toPixels,
  type LabColor,
  type ScalePoint,
} from './distance.js';
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

const NO_MATCH: ClassMatch = { matchedToken: null, distance: null };

/** A Tailwind arbitrary-value class split into its utility prefix and bracketed value. */
interface ArbitraryClass {
  prefix: string;
  value: string;
}

/** Split `bg-[#1a73e9]` into `{ prefix: 'bg', value: '#1a73e9' }`; null if not arbitrary. */
function parseArbitraryClass(input: string): ArbitraryClass | null {
  const match = ARBITRARY_CLASS.exec(input);
  const prefix = match?.[1];
  const value = match?.[2];
  if (prefix === undefined || value === undefined) return null;
  return { prefix, value };
}

interface ColorToken {
  name: string;
  lab: LabColor;
}

/** Pre-convert a token map's values into the shape the distance helpers expect. */
function toColorTokens(colors: TokenSet['colors']): ColorToken[] {
  return Object.entries(colors).flatMap(([name, value]) => {
    const lab = toPerceptualColor(value);
    return lab ? [{ name, lab }] : [];
  });
}

function toScalePoints(scale: Record<string, string>): ScalePoint[] {
  return Object.entries(scale).flatMap(([key, value]) => {
    const px = toPixels(value);
    return px === null ? [] : [{ key, px }];
  });
}

/**
 * Maps drift values (hardcoded colors, arbitrary Tailwind classes) back to the
 * closest design-system token, so callers can suggest a standard replacement.
 * Token colors and scales are converted once at construction time, so each
 * match is a cheap distance scan.
 */
export class TokenMatcher {
  private readonly colorThreshold: number;
  private readonly dimensionThreshold: number;
  private readonly colorTokens: ColorToken[];
  private readonly spacing: ScalePoint[];
  private readonly radius: ScalePoint[];

  constructor(tokens: TokenSet, options: MatcherOptions = {}) {
    this.colorThreshold = options.colorThreshold ?? DEFAULT_COLOR_THRESHOLD;
    this.dimensionThreshold = options.dimensionThreshold ?? DEFAULT_DIMENSION_THRESHOLD;
    this.colorTokens = toColorTokens(tokens.colors);
    this.spacing = toScalePoints(tokens.spacing);
    this.radius = toScalePoints(tokens.radius);
  }

  /** Names of every color token, e.g. `['brand-primary', 'danger', ...]`. */
  private colorNames(): string[] {
    return this.colorTokens.map((token) => token.name);
  }

  /**
   * The set of valid replacement tokens a drift value could map to, formatted
   * exactly as a suggestion would be: bare color names for inline colors
   * (`brand-primary`) and prefixed utilities for arbitrary classes (`p-3`,
   * `bg-brand-primary`). Used to constrain the LLM agent to real tokens rather
   * than letting it invent names.
   */
  candidatesFor(value: string): string[] {
    const parsed = parseArbitraryClass(value);
    // A raw color (no `prefix-[…]` shape) maps to the bare color-token names.
    if (!parsed) return this.colorNames();

    // A length-valued class maps to a spacing/radius scale; anything else is a
    // prefixed color class.
    const px = toPixels(parsed.value);
    if (px === null) return this.colorNames().map((name) => `${parsed.prefix}-${name}`);

    const scale = parsed.prefix.startsWith('rounded') ? this.radius : this.spacing;
    return scale.map((point) => `${parsed.prefix}-${point.key}`);
  }

  /** Find the perceptually closest color token to a raw color string. */
  matchColor(input: string): ColorMatch {
    const inputLab = toPerceptualColor(input);
    if (!inputLab) {
      return { matchedToken: null, deltaE: Infinity };
    }

    let best: string | null = null;
    let bestDelta = Infinity;
    for (const token of this.colorTokens) {
      const delta = deltaE(inputLab, token.lab);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = token.name;
      }
    }

    return {
      matchedToken: bestDelta <= this.colorThreshold ? best : null,
      deltaE: bestDelta,
    };
  }

  /** Suggest the standard Tailwind class closest to an arbitrary-value class. */
  matchClass(input: string): ClassMatch {
    const parsed = parseArbitraryClass(input);
    if (!parsed) return NO_MATCH;

    // Route by value type: a length matches a scale, anything else a color.
    const px = toPixels(parsed.value);
    return px === null
      ? this.matchColorClass(parsed.prefix, parsed.value)
      : this.matchDimensionClass(parsed.prefix, px);
  }

  /** Suggest the nearest spacing/radius utility, e.g. `p-[13px]` → `p-3`. */
  private matchDimensionClass(prefix: string, target: number): ClassMatch {
    const scale = prefix.startsWith('rounded') ? this.radius : this.spacing;
    const nearest = nearestScalePoint(target, scale);
    if (!nearest || nearest.distance > this.dimensionThreshold) {
      return { matchedToken: null, distance: nearest?.distance ?? null };
    }
    return { matchedToken: `${prefix}-${nearest.key}`, distance: nearest.distance };
  }

  /** Suggest a prefixed color utility, e.g. `bg-[#1a73e9]` → `bg-brand-primary`. */
  private matchColorClass(prefix: string, rawValue: string): ClassMatch {
    const { matchedToken, deltaE } = this.matchColor(rawValue);
    if (matchedToken === null) return NO_MATCH;
    return { matchedToken: `${prefix}-${matchedToken}`, distance: deltaE };
  }
}
