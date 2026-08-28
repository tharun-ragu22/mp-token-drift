import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { FindingType } from '../scanner/astScanner.js';
import { DEFAULT_LLM_PROVIDER, resolveModel, type ResolvedModel } from './modelFactory.js';

/** The structured object the reasoning agent must produce. */
export const driftExplanationSchema = z.object({
  /** The recommended semantic design token (or Tailwind utility). */
  semanticToken: z.string().min(1),
  /** Model confidence in the suggestion, 0..1. */
  confidence: z.number().min(0).max(1),
  /** A short, human-readable rationale a developer can act on. */
  explanation: z.string().min(1),
});

export type DriftExplanationObject = z.infer<typeof driftExplanationSchema>;

/** A drift explanation, tagged with whether it came from the LLM or the AST. */
export interface DriftExplanation extends DriftExplanationObject {
  source: 'ast' | 'llm';
}

/** Everything the agent needs to reason about a single drift finding. */
export interface DriftContext {
  value: string;
  type: FindingType;
  /** The nearest token from static analysis, or null when none was close. */
  baselineSuggestion: string | null;
  /** Optional source snippet for extra context. */
  snippet?: string;
}

/** Toggles and provider selection for the reasoning agent. */
export interface AiOptions {
  enabled?: boolean;
  provider?: string;
  model?: string;
}

export interface AiGenerateArgs {
  model: LanguageModel;
  schema: typeof driftExplanationSchema;
  prompt: string;
}

export interface AiGenerateResult {
  object: unknown;
}

export type AiGenerateFn = (args: AiGenerateArgs) => Promise<AiGenerateResult>;

/** Injectable seams so tests can run the pipeline against a mock provider. */
export interface ExplainDriftDeps {
  resolve?: (provider: string, modelId?: string) => ResolvedModel;
  generate?: AiGenerateFn;
}

const defaultGenerate: AiGenerateFn = async ({ model, schema, prompt }) => {
  const result = await generateObject({ model, schema, prompt });
  return { object: result.object };
};

function buildPrompt(context: DriftContext): string {
  const baseline = context.baselineSuggestion ?? '(none found by static analysis)';
  return [
    'You are a design-system linter. A component uses a hardcoded value that drifts',
    'from the approved design tokens. Recommend the single closest semantic token.',
    '',
    `Drift type: ${context.type}`,
    `Raw value: ${context.value}`,
    context.snippet ? `Source: ${context.snippet}` : '',
    `Nearest token from static analysis: ${baseline}`,
    '',
    'Reply with the semantic token name, a confidence in [0,1], and a one-sentence',
    'explanation a developer can act on.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The AST-only result used when AI is disabled or as a deterministic fallback. */
function baselineExplanation(context: DriftContext): DriftExplanation {
  const token = context.baselineSuggestion;
  if (token) {
    return {
      semanticToken: token,
      confidence: 1,
      explanation: `Static analysis matched "${context.value}" to the "${token}" design token.`,
      source: 'ast',
    };
  }
  return {
    semanticToken: '',
    confidence: 0,
    explanation: `No design token is close enough to "${context.value}".`,
    source: 'ast',
  };
}

/**
 * Explain a drift finding. When AI is disabled the AST baseline is returned
 * immediately with no model resolution and no API call. When enabled, the
 * resolved model produces a Zod-validated structured suggestion.
 */
export async function explainDrift(
  context: DriftContext,
  options: AiOptions = {},
  deps: ExplainDriftDeps = {},
): Promise<DriftExplanation> {
  if (!options.enabled) {
    return baselineExplanation(context);
  }

  const resolve = deps.resolve ?? resolveModel;
  const generate = deps.generate ?? defaultGenerate;

  const { model } = resolve(options.provider ?? DEFAULT_LLM_PROVIDER, options.model);
  const { object } = await generate({
    model,
    schema: driftExplanationSchema,
    prompt: buildPrompt(context),
  });

  // Validate defensively — guarantees schema compliance regardless of provider.
  const parsed = driftExplanationSchema.parse(object);
  return { ...parsed, source: 'llm' };
}
