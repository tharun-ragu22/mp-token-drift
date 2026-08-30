import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Namespace prefix so the key is self-describing in the Actions cache UI. */
export const CACHE_KEY_PREFIX = 'mp-token-drift';

/** Sentinel folded into the digest when the (optional) config file is absent. */
const NO_CONFIG_SENTINEL = '\0mp-token-drift:no-config\0';

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Read a file, or return `null` if it does not exist (rethrowing other errors). */
function readIfExists(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

/**
 * Compute a deterministic GitHub Actions cache key from the drift config and
 * token schema files. Both files' contents are folded into a single SHA-256
 * digest, so the key changes whenever either input changes — letting a workflow
 * key its `actions/cache` on the exact configuration that produced a scan.
 *
 * The config file is optional (a project may run purely on flags/defaults): a
 * missing one contributes a fixed sentinel rather than throwing, and a missing
 * config is distinct from a present-but-empty one. The tokens file is required,
 * so a missing tokens file still throws.
 *
 * Each file's byte length is mixed in ahead of its bytes so that moving content
 * from one file to the other can never collide (`("A","B")` ≠ `("AB","")`).
 */
export function computeCacheKey(configPath: string, tokensPath: string): string {
  const hash = createHash('sha256');

  const configBytes = readIfExists(configPath);
  if (configBytes === null) {
    hash.update(NO_CONFIG_SENTINEL);
  } else {
    hash.update(`${configBytes.length}\0`);
    hash.update(configBytes);
  }

  const tokenBytes = readFileSync(tokensPath);
  hash.update(`${tokenBytes.length}\0`);
  hash.update(tokenBytes);

  return `${CACHE_KEY_PREFIX}-${hash.digest('hex')}`;
}
