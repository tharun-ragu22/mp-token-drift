import { createTwoFilesPatch } from 'diff';

/**
 * Render a unified, git-style diff between the original and transformed source
 * for a file, suitable for printing to stdout in `--dry-run` mode. The paths
 * are prefixed `a/` and `b/` to match `git diff` output.
 */
export function generateDiff(filePath: string, before: string, after: string): string {
  return createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, before, after, '', '');
}
