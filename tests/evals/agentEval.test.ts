import { describe, expect, it } from 'vitest';
import { loadTokens } from '../../src/matcher/schema.js';
import { TokenMatcher } from '../../src/matcher/tokenMatcher.js';
import {
  driftExplanationSchema,
  explainDrift,
  type DriftContext,
  type ExplainDriftDeps,
} from '../../src/agent/explainDrift.js';
import { evalDataset, type EvalCase } from './dataset.js';

const matcher = new TokenMatcher(loadTokens('fixtures/tokens.sample.json'));

// Live evals need a real key; CI usually has none. When absent we run the full
// explainDrift pipeline (prompt build -> generate -> Zod validation) against a
// deterministic mock provider so the harness and metrics are still exercised.
const LIVE_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] as const;
const liveProvider = process.env.ANTHROPIC_API_KEY
  ? 'anthropic'
  : process.env.OPENAI_API_KEY
    ? 'openai'
    : process.env.GOOGLE_GENERATIVE_AI_API_KEY
      ? 'google'
      : undefined;
const hasLiveKey = LIVE_KEYS.some((key) => Boolean(process.env[key]));

/** Static-analysis baseline for a case, matching the real scan pipeline. */
function baselineFor(testCase: EvalCase): string | null {
  return testCase.type === 'hardcoded-color'
    ? matcher.matchColor(testCase.value).matchedToken
    : matcher.matchClass(testCase.value).matchedToken;
}

function contextFor(testCase: EvalCase): DriftContext {
  return {
    value: testCase.value,
    type: testCase.type,
    baselineSuggestion: baselineFor(testCase),
    snippet: testCase.jsx,
  };
}

/** Mock provider that returns the ground-truth token, so the pipeline (not the
 *  model) is what gets validated when no live key is available. */
function mockDeps(expectedToken: string): ExplainDriftDeps {
  return {
    resolve: () => ({ provider: 'anthropic', modelId: 'mock-model', model: {} as never }),
    generate: async () => ({
      object: {
        semanticToken: expectedToken,
        confidence: 0.9,
        explanation: `Replace the hardcoded value with the ${expectedToken} design token.`,
      },
    }),
  };
}

async function explain(testCase: EvalCase) {
  const context = contextFor(testCase);
  if (hasLiveKey) {
    return explainDrift(context, { enabled: true, provider: liveProvider });
  }
  return explainDrift(context, { enabled: true }, mockDeps(testCase.expectedToken));
}

describe('explainDrift evaluation suite', () => {
  it(`meets accuracy, schema, and explanation thresholds${hasLiveKey ? ' (live)' : ' (mock provider)'}`, async () => {
    let tokenMatches = 0;
    let schemaValid = 0;
    let explanationsOk = 0;

    for (const testCase of evalDataset) {
      const result = await explain(testCase);

      if (result.semanticToken === testCase.expectedToken) tokenMatches += 1;
      if (driftExplanationSchema.safeParse(result).success) schemaValid += 1;
      if (result.explanation.trim().length >= 10 && result.explanation.length <= 600) {
        explanationsOk += 1;
      }
    }

    const total = evalDataset.length;

    // (a) Token match accuracy >= 90%.
    expect(tokenMatches / total).toBeGreaterThanOrEqual(0.9);
    // (b) Zod schema compliance == 100%.
    expect(schemaValid).toBe(total);
    // (c) Every explanation is a valid, human-readable length.
    expect(explanationsOk).toBe(total);
  });
});

describe('explainDrift — AI disabled', () => {
  it('returns the AST baseline immediately without resolving a model or calling the API', async () => {
    let touched = false;
    const result = await explainDrift(
      { value: '#1a73e9', type: 'hardcoded-color', baselineSuggestion: 'brand-primary' },
      { enabled: false },
      {
        resolve: () => {
          touched = true;
          throw new Error('resolve should not be called when AI is disabled');
        },
        generate: async () => {
          touched = true;
          return { object: {} };
        },
      },
    );

    expect(touched).toBe(false);
    expect(result.source).toBe('ast');
    expect(result.semanticToken).toBe('brand-primary');
  });
});
