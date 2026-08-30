import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Namespace prefix so the key is self-describing in the Actions cache UI. */
export const CACHE_KEY_PREFIX = 'mp-token-drift';

/**
 * Compute a deterministic GitHub Actions cache key from the drift config and
 * token schema files. Both files' contents are folded into a single SHA-256
 * digest, so the key changes whenever either input changes — letting a workflow
 * key its `actions/cache` on the exact configuration that produced a scan.
 *
 * Each file's byte length is mixed in ahead of its bytes so that moving content
 * from one file to the other can never collide (`("A","B")` ≠ `("AB","")`).
 */
export function computeCacheKey(configPath: string, tokensPath: string): string {
  const hash = createHash('sha256');
  for (const path of [configPath, tokensPath]) {
    const bytes = readFileSync(path);
    hash.update(`${bytes.length}\0`);
    hash.update(bytes);
  }
  return `${CACHE_KEY_PREFIX}-${hash.digest('hex')}`;
}
