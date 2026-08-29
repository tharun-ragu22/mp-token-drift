import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';

/** Providers this factory can resolve a model from. */
export type LlmProvider = 'anthropic' | 'google' | 'openai' | 'ollama';

/** A resolved language model plus the provider/model it was resolved to. */
export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  model: LanguageModel;
}

interface ProviderConfig {
  /**
   * Environment variable holding this provider's API key, or undefined for a
   * local provider (e.g. Ollama) that authenticates no request.
   */
  apiKeyEnv?: string;
  /**
   * Default model when the caller doesn't specify one. Kept here (config), not
   * baked into the reasoning code, so a version bump is a one-line change and
   * callers can always override via CLI/config/env.
   */
  defaultModel: string;
  create: (apiKey: string | undefined, modelId: string) => LanguageModel;
}

const PROVIDERS: Record<LlmProvider, ProviderConfig> = {
  anthropic: {
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-4-8',
    create: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  },
  google: {
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    create: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  },
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    create: (apiKey, modelId) => {
      // `OPENAI_BASE_URL`, when set, points the OpenAI-compatible client at any
      // other server that speaks the same protocol — e.g. a locally served
      // Ollama model (`http://localhost:11434/v1`) used by the CI eval job.
      const baseURL = process.env.OPENAI_BASE_URL;
      const client = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      // The default callable targets OpenAI's Responses API, which compatible
      // servers like Ollama don't implement — pin to chat completions (the
      // universally supported surface) whenever a custom endpoint is set.
      return baseURL ? client.chat(modelId) : client(modelId);
    },
  },
  ollama: {
    // Local models need no key. Unlike the OpenAI-compatibility shim, this
    // provider talks Ollama's native API and forwards the response schema as
    // its `format` field, which drives grammar-constrained decoding — the
    // model is *guaranteed* to emit schema-valid JSON, so structured output
    // never degrades to prose on a small model. `OLLAMA_BASE_URL` overrides
    // the default `http://127.0.0.1:11434/api` endpoint when set.
    defaultModel: 'llama3.2',
    create: (_apiKey, modelId) => {
      const baseURL = process.env.OLLAMA_BASE_URL;
      return createOllama({ ...(baseURL ? { baseURL } : {}) })(modelId);
    },
  },
};

/** Provider used when none is specified via CLI, config, or environment. */
export const DEFAULT_LLM_PROVIDER: LlmProvider = 'anthropic';

function isSupported(provider: string): provider is LlmProvider {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}

/**
 * Build a provider-agnostic language model. The provider and (optional) model
 * id are supplied dynamically — nothing about a specific model version is
 * hardcoded in the reasoning code that calls this. Throws for an unsupported
 * provider or a missing API key.
 */
export function resolveModel(provider: string, modelId?: string): ResolvedModel {
  if (!isSupported(provider)) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unsupported provider "${provider}". Supported providers: ${supported}.`);
  }

  const config = PROVIDERS[provider];
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  if (config.apiKeyEnv && !apiKey) {
    throw new Error(
      `Missing API key for provider "${provider}". Set the ${config.apiKeyEnv} environment variable.`,
    );
  }

  const resolvedModelId = modelId ?? config.defaultModel;
  return {
    provider,
    modelId: resolvedModelId,
    model: config.create(apiKey, resolvedModelId),
  };
}

/**
 * Resolve a model from the `LLM_PROVIDER` / `LLM_MODEL` environment variables,
 * falling back to the default provider and that provider's default model.
 */
export function resolveModelFromEnv(): ResolvedModel {
  const provider = process.env.LLM_PROVIDER ?? DEFAULT_LLM_PROVIDER;
  return resolveModel(provider, process.env.LLM_MODEL);
}
