import { CommanderError } from 'commander';
import { buildProgram } from './program.js';
import { runScan } from './scan.js';
import { CliError } from './CliError.js';

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Parse and execute CLI arguments, capturing all output and the intended exit
 * code instead of writing to the process directly. This keeps the CLI testable
 * and lets the thin bin wrapper own the actual `process.exit`.
 */
export async function run(argv: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode = 0;

  const program = buildProgram(async (patterns, options) => {
    const outcome = await runScan(patterns, options);
    out.push(outcome.stdout);
    if (outcome.stderr) err.push(outcome.stderr);
    exitCode = outcome.exitCode;
  });
  program.configureOutput({
    writeOut: (str) => out.push(str),
    writeErr: (str) => err.push(str),
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CliError) {
      err.push(`${error.message}\n`);
      exitCode = error.exitCode;
    } else if (error instanceof CommanderError) {
      // Help/version/usage errors: commander already wrote the message.
      exitCode = error.exitCode;
    } else {
      err.push(`${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 2;
    }
  }

  return { stdout: out.join(''), stderr: err.join(''), exitCode };
}
