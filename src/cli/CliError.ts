/**
 * An error carrying the process exit code the CLI should terminate with.
 * Thrown for user-facing failures (bad config, missing tokens) so the top-level
 * runner can print a readable message and exit with the right code.
 */
export class CliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
