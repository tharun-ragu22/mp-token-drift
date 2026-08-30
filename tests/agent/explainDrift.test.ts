import { describe, expect, it } from 'vitest';
import {
  driftExplanationSchema,
  explainDrift,
  type AiGenerateArgs,
  type DriftContext,
  type ExplainDriftDeps,
} from '../../src/agent/explainDrift.js';

/**
 * These are contract tests: they pin down the agreement between the shape the
 * LLM is expected to return and how the application consumes it. They never
 * call a real model — a well-behaved or misbehaving provider is simulated
 * through the injected `resolve`/`generate` seams. Measuring how good a real
 * model's answers actually are is the job of the eval suite, not these tests.
 */

const context: DriftContext = {
  value: '#1a73e9',
  type: 'hardcoded-color',
  baselineSuggestion: 'brand-primary',
  snippet: '<div style={{ color: "#1a73e9" }} />',
  candidates: ['brand-primary', 'danger', 'white'],
};

/** A provider stub that never touches the network. */
function stubResolve(): ExplainDriftDeps['resolve'] {
  return () => ({ provider: 'anthropic', modelId: 'stub-model', model: {} as never });
}

/** Deps whose model returns a fixed object, capturing the request it received. */
function depsReturning(object: unknown): {
  deps: ExplainDriftDeps;
  calls: { resolvedWith?: { provider: string; modelId?: string }; args?: AiGenerateArgs };
} {
  const calls: { resolvedWith?: { provider: string; modelId?: string }; args?: AiGenerateArgs } =
    {};
  return {
    calls,
    deps: {
      resolve: (provider, modelId) => {
        calls.resolvedWith = { provider, modelId };
        return { provider: 'anthropic', modelId: 'stub-model', model: {} as never };
      },
      generate: async (args) => {
        calls.args = args;
        return { object };
      },
    },
  };
}

describe('explainDrift — consuming a well-formed model response', () => {
  it('passes the validated fields through and tags the source as llm', async () => {
    const object = {
      semanticToken: 'brand-primary',
      confidence: 0.82,
      explanation: 'This blue sits within tolerance of the brand-primary token.',
    };
    const { deps } = depsReturning(object);

    const result = await explainDrift(context, { enabled: true }, deps);

    expect(result).toEqual({ ...object, source: 'llm' });
    // The consumed object must itself satisfy the published schema.
    expect(driftExplanationSchema.safeParse(result).success).toBe(true);
  });
});

describe('explainDrift — request contract', () => {
  it('resolves the provider/model from options and builds a prompt from the drift context', async () => {
    const { deps, calls } = depsReturning({
      semanticToken: 'brand-primary',
      confidence: 1,
      explanation: 'ok',
    });

    await explainDrift(context, { enabled: true, provider: 'openai', model: 'gpt-x' }, deps);

    expect(calls.resolvedWith).toEqual({ provider: 'openai', modelId: 'gpt-x' });
    expect(calls.args?.schema).toBe(driftExplanationSchema);
    // The prompt must carry the concrete finding so the model has something to reason about.
    expect(calls.args?.prompt).toContain('#1a73e9');
    expect(calls.args?.prompt).toContain('brand-primary');
    // ...and constrain the choice to the real design-system tokens.
    expect(calls.args?.prompt).toContain('danger');
    expect(calls.args?.prompt).toContain('white');
  });

  it('falls back to the default provider when none is supplied', async () => {
    const { deps, calls } = depsReturning({
      semanticToken: 'brand-primary',
      confidence: 1,
      explanation: 'ok',
    });

    await explainDrift(context, { enabled: true }, deps);

    expect(calls.resolvedWith?.provider).toBe('anthropic');
    expect(calls.resolvedWith?.modelId).toBeUndefined();
  });
});

describe('explainDrift — rejecting malformed model output', () => {
  const cases: { name: string; object: unknown }[] = [
    { name: 'a missing explanation', object: { semanticToken: 'x', confidence: 0.5 } },
    {
      name: 'an empty semantic token',
      object: { semanticToken: '', confidence: 0.5, explanation: 'y' },
    },
    {
      name: 'a confidence above 1',
      object: { semanticToken: 'x', confidence: 1.5, explanation: 'y' },
    },
    {
      name: 'a confidence below 0',
      object: { semanticToken: 'x', confidence: -0.2, explanation: 'y' },
    },
    {
      name: 'a non-numeric confidence',
      object: { semanticToken: 'x', confidence: 'high', explanation: 'y' },
    },
    { name: 'a completely empty object', object: {} },
  ];

  for (const { name, object } of cases) {
    it(`throws rather than forwarding ${name}`, async () => {
      const deps: ExplainDriftDeps = { resolve: stubResolve(), generate: async () => ({ object }) };
      await expect(explainDrift(context, { enabled: true }, deps)).rejects.toThrow();
    });
  }
});

describe('explainDrift — AI disabled', () => {
  it('returns the AST baseline immediately without resolving a model or calling the API', async () => {
    let touched = false;
    const result = await explainDrift(
      context,
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
