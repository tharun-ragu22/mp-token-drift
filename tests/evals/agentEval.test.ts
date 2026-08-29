import { describe, expect, it } from 'vitest';
import { loadTokens } from '../../src/matcher/schema.js';
import { TokenMatcher } from '../../src/matcher/tokenMatcher.js';
import { explainDrift, type DriftContext } from '../../src/agent/explainDrift.js';
import { evalDataset, type EvalCase } from './dataset.js';

/**
 * Real evaluation suite. Unlike the contract tests, this drives `explainDrift`
 * against an actual language model and scores the quality of its answers, so it
 * only runs when explicitly opted in with `RUN_LLM_EVALS=1`. CI wires this to a
 * locally served Gemma model (via an OpenAI-compatible endpoint) and runs it as
 * a separate job that starts only after the deterministic suite is green.
 *
 * The provider/model come from the environment so the same eval can target the
 * local model in CI or a hosted provider locally:
 *   RUN_LLM_EVALS=1 LLM_PROVIDER=openai LLM_MODEL=gemma3n:e4b \
 *   OPENAI_API_KEY=ollama OPENAI_BASE_URL=http://localhost:11434/v1 npm run eval
 */

const RUN_EVALS = process.env.RUN_LLM_EVALS === '1';
const PROVIDER = process.env.LLM_PROVIDER ?? 'openai';
const MODEL = process.env.LLM_MODEL;
// A small local model is held to a slightly lower bar than a frontier model;
// tune the gate per model via EVAL_MIN_ACCURACY without touching code.
const MIN_ACCURACY = Number(process.env.EVAL_MIN_ACCURACY ?? '0.9');

const matcher = new TokenMatcher(loadTokens('fixtures/tokens.sample.json'));

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

describe.skipIf(!RUN_EVALS)(
  `explainDrift evals — live model (${PROVIDER}/${MODEL ?? 'default'})`,
  () => {
    it(`meets accuracy (>=${MIN_ACCURACY}), schema, and explanation thresholds`, async () => {
      let tokenMatches = 0;
      let schemaValid = 0;
      let explanationsOk = 0;

      for (const testCase of evalDataset) {
        let result;
        try {
          result = await explainDrift(contextFor(testCase), {
            enabled: true,
            provider: PROVIDER,
            model: MODEL,
          });
        } catch {
          // A throw means the model failed to produce schema-valid output for
          // this case — counted against schema compliance, not a test crash.
          continue;
        }

        schemaValid += 1;
        if (result.semanticToken === testCase.expectedToken) tokenMatches += 1;
        if (result.explanation.trim().length >= 10 && result.explanation.length <= 600) {
          explanationsOk += 1;
        }
      }

      const total = evalDataset.length;

      // (a) Token match accuracy meets the configured bar.
      expect(tokenMatches / total).toBeGreaterThanOrEqual(MIN_ACCURACY);
      // (b) Every answer that came back satisfied the Zod schema.
      expect(schemaValid).toBe(total);
      // (c) Every explanation is a valid, human-readable length.
      expect(explanationsOk).toBe(total);
    }, 120_000); // Local CPU inference is slow; give the whole dataset room to complete.
  },
);
