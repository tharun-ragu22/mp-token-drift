import { CommanderError } from 'commander';
import { buildProgram } from './program.js';
import { runScan } from './scan.js';
import { CliError } from './CliError.js';
import { OutputCapture, type CliResult } from './output.js';

export type { CliResult } from './output.js';

/**
 * Parse and execute CLI arguments, capturing all output and the intended exit
 * code instead of writing to the process directly. This keeps the CLI testable
 * and lets the thin bin wrapper own the actual `process.exit`.
 */
export async function run(argv: string[]): Promise<CliResult> {
  const capture = new OutputCapture();
  let exitCode = 0;

  const program = buildProgram(async (patterns, options) => {
    const outcome = await runScan(patterns, options);
    capture.writeOut(outcome.stdout);
    capture.writeErr(outcome.stderr);
    exitCode = outcome.exitCode;
  });
  program.configureOutput({
    writeOut: (str) => capture.writeOut(str),
    writeErr: (str) => capture.writeErr(str),
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CliError) {
      capture.writeErr(`${error.message}\n`);
      exitCode = error.exitCode;
    } else if (error instanceof CommanderError) {
      // Help/version/usage errors: commander already wrote the message.
      exitCode = error.exitCode;
    } else {
      capture.writeErr(`${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 2;
    }
  }

  return capture.toResult(exitCode);
}
