import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveModel, resolveModelFromEnv } from '../../src/agent/modelFactory.js';

// Env vars the factory reads. We snapshot and restore them around each test so
// a stray provider key in CI can't leak between cases (mirrors the restoreEnv
// pattern in cli.test.ts).
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_API_KEY',
  'LLM_PROVIDER',
  'LLM_MODEL',
] as const;

describe('resolveModel', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // Dummy keys let us construct provider models without a network call.
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('resolves an Anthropic model via @ai-sdk/anthropic, defaulting the model id', () => {
    const resolved = resolveModel('anthropic');
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.modelId).toBe('claude-opus-4-8');
    expect(resolved.model).toBeTypeOf('object');
  });

  it('honours an explicit Anthropic model id (no version hardcoded in core code)', () => {
    const resolved = resolveModel('anthropic', 'claude-haiku-4-5');
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.modelId).toBe('claude-haiku-4-5');
  });

  it('resolves a Google model via @ai-sdk/google', () => {
    const resolved = resolveModel('google');
    expect(resolved.provider).toBe('google');
    expect(resolved.model).toBeTypeOf('object');
    expect(resolved.modelId.length).toBeGreaterThan(0);
  });

  it('resolves an OpenAI model via @ai-sdk/openai', () => {
    const resolved = resolveModel('openai');
    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBeTypeOf('object');
    expect(resolved.modelId.length).toBeGreaterThan(0);
  });

  it('resolves an Ollama model with no API key (local provider)', () => {
    // A local provider authenticates nothing, so it must resolve even when no
    // key env var is set — the distinguishing behaviour from hosted providers.
    delete process.env.OPENAI_API_KEY;
    const resolved = resolveModel('ollama');
    expect(resolved.provider).toBe('ollama');
    expect(resolved.model).toBeTypeOf('object');
    expect(resolved.modelId.length).toBeGreaterThan(0);
  });

  it('honours an explicit Ollama model id', () => {
    const resolved = resolveModel('ollama', 'gemma4:e4b');
    expect(resolved.provider).toBe('ollama');
    expect(resolved.modelId).toBe('gemma4:e4b');
  });

  it('resolves dynamically from LLM_PROVIDER / LLM_MODEL environment variables', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-5';
    const resolved = resolveModelFromEnv();
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.modelId).toBe('claude-sonnet-5');
  });

  it('throws for an unsupported provider', () => {
    expect(() => resolveModel('cohere')).toThrow(/unsupported provider/i);
  });

  it('throws when the required API key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveModel('anthropic')).toThrow(/api key/i);
  });
});
