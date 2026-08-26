import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** A hex color literal, e.g. `#1a73e8` or `#f00`. */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'must be a hex color');

/** A CSS length token, e.g. `12px`, `1.5rem`, `9999px`. */
const dimension = z.string().regex(/^-?\d*\.?\d+(px|rem|em|%)?$/, 'must be a CSS dimension');

/**
 * The design-system token file: a bag of named colors plus spacing and radius
 * scales. Scale keys double as the Tailwind suffix used to suggest a standard
 * class (e.g. spacing `3` → `p-3`, radius `md` → `rounded-md`).
 */
export const tokenSetSchema = z.object({
  colors: z.record(z.string(), hexColor),
  spacing: z.record(z.string(), dimension),
  radius: z.record(z.string(), dimension),
});

export type TokenSet = z.infer<typeof tokenSetSchema>;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Validate an already-parsed object against the token schema. */
export function parseTokens(data: unknown): TokenSet {
  return tokenSetSchema.parse(data);
}

/** Read and validate a tokens JSON file from disk. */
export function loadTokens(filePath: string): TokenSet {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error(`Tokens file not found: ${filePath}`);
    }
    throw error;
  }
  return parseTokens(JSON.parse(raw) as unknown);
}
