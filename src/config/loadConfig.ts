import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CliError } from '../cli/CliError.js';
import type { OutputFormat } from '../reporter/types.js';

const DEFAULT_CONFIG_PATH = 'drift.config.json';

const configFileSchema = z
  .object({
    tokens: z.string().optional(),
    include: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
    format: z.enum(['console', 'json', 'sarif']).optional(),
    failOnDrift: z.boolean().optional(),
    maxDrift: z.number().int().nonnegative().optional(),
  })
  .strict();

type FileConfig = z.infer<typeof configFileSchema>;

/** Options passed from the command line; each overrides the config file. */
export interface CliOverrides {
  configPath?: string;
  tokens?: string;
  patterns?: string[];
  ignore?: string[];
  format?: OutputFormat;
  failOnDrift?: boolean;
  maxDrift?: number;
}

/** Fully-resolved configuration after merging defaults, file, and CLI options. */
export interface ResolvedConfig {
  tokens: string;
  include: string[];
  ignore: string[];
  format: OutputFormat;
  failOnDrift: boolean;
  maxDrift: number;
}

const DEFAULTS: ResolvedConfig = {
  tokens: 'tokens.json',
  include: ['**/*.tsx'],
  ignore: [],
  format: 'console',
  failOnDrift: false,
  maxDrift: 0,
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Read and validate `drift.config.json`. A config file is optional unless the
 * user explicitly pointed at one with `--config`, in which case a missing or
 * malformed file is a fatal (exit 2) error.
 */
function readConfigFile(configPath: string | undefined): FileConfig {
  const explicit = configPath !== undefined;
  const path = configPath ?? DEFAULT_CONFIG_PATH;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      if (explicit) throw new CliError(2, `Config file not found: ${path}`);
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(2, `Config file is not valid JSON: ${path}`);
  }

  const result = configFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      2,
      `Invalid config file ${path}: ${result.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  return result.data;
}

/** Merge defaults, the config file, and CLI overrides into a single config. */
export function loadConfig(overrides: CliOverrides): ResolvedConfig {
  const file = readConfigFile(overrides.configPath);
  const patterns = overrides.patterns ?? [];

  return {
    tokens: overrides.tokens ?? file.tokens ?? DEFAULTS.tokens,
    include: patterns.length > 0 ? patterns : (file.include ?? DEFAULTS.include),
    ignore: [...(file.ignore ?? []), ...(overrides.ignore ?? [])],
    format: overrides.format ?? file.format ?? DEFAULTS.format,
    failOnDrift: overrides.failOnDrift ?? file.failOnDrift ?? DEFAULTS.failOnDrift,
    maxDrift: overrides.maxDrift ?? file.maxDrift ?? DEFAULTS.maxDrift,
  };
}
