import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/** Providers this factory can resolve a model from. */
export type LlmProvider = 'anthropic' | 'google' | 'openai';

/** A resolved language model plus the provider/model it was resolved to. */
export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  model: LanguageModel;
}

interface ProviderConfig {
  /** Environment variable holding this provider's API key. */
  apiKeyEnv: string;
  /**
   * Default model when the caller doesn't specify one. Kept here (config), not
   * baked into the reasoning code, so a version bump is a one-line change and
   * callers can always override via CLI/config/env.
   */
  defaultModel: string;
  create: (apiKey: string, modelId: string) => LanguageModel;
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
    create: (apiKey, modelId) => createOpenAI({ apiKey })(modelId),
  },
};

const DEFAULT_PROVIDER: LlmProvider = 'anthropic';

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
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
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
  const provider = process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
  return resolveModel(provider, process.env.LLM_MODEL);
}
