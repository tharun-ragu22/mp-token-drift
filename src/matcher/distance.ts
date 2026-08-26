import { lab as toLab, differenceCiede2000, type Lab } from 'culori';

const ciede2000 = differenceCiede2000();

/** A color pre-converted into CIELAB space for repeated perceptual comparisons. */
export type LabColor = Lab;

/**
 * Parse a color string into CIELAB once, up front. Converting a color a single
 * time and reusing the result keeps repeated Delta-E comparisons cheap, since
 * the expensive sRGB → XYZ → Lab conversion no longer happens per comparison.
 * Returns null for strings culori cannot recognize as colors.
 */
export function toPerceptualColor(color: string): LabColor | null {
  return toLab(color) ?? null;
}

/** CIEDE2000 perceptual distance between two already-converted Lab colors. */
export function deltaE(a: LabColor, b: LabColor): number {
  return ciede2000(a, b);
}

/** Convert a CSS length (`12px`, `1.5rem`) to pixels; null if not a length. */
export function toPixels(value: string): number | null {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const magnitude = Number(match[1]);
  if (Number.isNaN(magnitude)) return null;
  const unit = match[2] ?? 'px';
  return unit === 'px' ? magnitude : magnitude * 16;
}

/** A named point on a numeric scale (e.g. spacing key `3` at 12 pixels). */
export interface ScalePoint {
  key: string;
  px: number;
}

/** The closest scale point to a target value, or null for an empty scale. */
export function nearestScalePoint(
  target: number,
  scale: readonly ScalePoint[],
): { key: string; distance: number } | null {
  let best: ScalePoint | null = null;
  let bestDistance = Infinity;
  for (const point of scale) {
    const distance = Math.abs(target - point.px);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best ? { key: best.key, distance: bestDistance } : null;
}
