import type { DriftItem } from './types.js';

const RULES: Record<DriftItem['type'], { name: string; description: string }> = {
  'hardcoded-color': {
    name: 'HardcodedColor',
    description: 'A hardcoded color literal that does not use a design-system token.',
  },
  'arbitrary-class': {
    name: 'ArbitraryClass',
    description: 'A Tailwind arbitrary-value class that bypasses the design-system scale.',
  },
};

function message(item: DriftItem): string {
  const base = `Token drift: ${item.value}`;
  return item.suggestion ? `${base} — did you mean ${item.suggestion}?` : base;
}

/**
 * Render findings as a SARIF v2.1.0 report so GitHub code scanning can ingest
 * them. Only the rules actually triggered are declared in the tool driver.
 */
export function formatSarif(items: DriftItem[]): string {
  const usedRuleIds = [...new Set(items.map((item) => item.type))];
  const rules = usedRuleIds.map((id) => ({
    id,
    name: RULES[id].name,
    shortDescription: { text: RULES[id].description },
  }));

  const results = items.map((item) => ({
    ruleId: item.type,
    level: 'warning',
    message: { text: message(item) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: item.file },
          region: { startLine: item.line },
        },
      },
    ],
  }));

  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'mp-token-drift',
              informationUri: 'https://github.com/tharun-ragu22/mp-token-drift',
              version: '1.0.0',
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}
