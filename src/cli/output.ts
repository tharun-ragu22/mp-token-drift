export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Buffers stdout/stderr writes so the CLI core stays free of process I/O and
 * stays testable. The thin bin wrapper flushes the captured result and exits.
 */
export class OutputCapture {
  private readonly out: string[] = [];
  private readonly err: string[] = [];

  writeOut(text: string): void {
    if (text) this.out.push(text);
  }

  writeErr(text: string): void {
    if (text) this.err.push(text);
  }

  toResult(exitCode: number): CliResult {
    return { stdout: this.out.join(''), stderr: this.err.join(''), exitCode };
  }
}
