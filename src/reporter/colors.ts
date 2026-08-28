import { Chalk, type ChalkInstance } from 'chalk';

/**
 * Colors are on by default but disabled in CI or when NO_COLOR is set, so piped
 * and CI logs stay clean and machine-readable.
 */
function colorsDisabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return true;
  const ci = process.env.CI;
  return ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0';
}

/** A Chalk instance with color forced on or off based on the environment. */
export function createChalk(): ChalkInstance {
  return new Chalk({ level: colorsDisabled() ? 0 : 1 });
}
