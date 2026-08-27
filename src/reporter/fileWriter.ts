import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Write report content to a file, creating parent directories as needed. */
export function writeReport(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
}
