import type { FindingType } from '../../src/scanner/astScanner.js';

/** One ground-truth drift case: a snippet, the raw drifted value, and the
 *  design-system token a correct agent should recommend. Expected tokens line
 *  up with `fixtures/tokens.sample.json`. */
export interface EvalCase {
  /** A representative JSX/TSX snippet containing the drift. */
  jsx: string;
  /** The raw drifted value extracted from the snippet. */
  value: string;
  /** What kind of drift this is. */
  type: FindingType;
  /** The token (or Tailwind utility) a correct agent should recommend. */
  expectedToken: string;
}

export const evalDataset: EvalCase[] = [
  {
    jsx: `<button style={{ backgroundColor: '#1a73e9' }}>Save</button>`,
    value: '#1a73e9',
    type: 'hardcoded-color',
    expectedToken: 'brand-primary',
  },
  {
    jsx: `<span style={{ color: '#188039' }}>Online</span>`,
    value: '#188039',
    type: 'hardcoded-color',
    expectedToken: 'brand-secondary',
  },
  {
    jsx: `<div style={{ borderColor: '#d93026' }} />`,
    value: '#d93026',
    type: 'hardcoded-color',
    expectedToken: 'danger',
  },
  {
    jsx: `<p style={{ color: '#202125' }}>Heading</p>`,
    value: '#202125',
    type: 'hardcoded-color',
    expectedToken: 'neutral-900',
  },
  {
    jsx: `<div style={{ backgroundColor: '#fff' }} />`,
    value: '#fff',
    type: 'hardcoded-color',
    expectedToken: 'white',
  },
  {
    jsx: `<div className="p-[13px]" />`,
    value: 'p-[13px]',
    type: 'arbitrary-class',
    expectedToken: 'p-3',
  },
  {
    jsx: `<div className="rounded-[7px]" />`,
    value: 'rounded-[7px]',
    type: 'arbitrary-class',
    expectedToken: 'rounded-md',
  },
  {
    jsx: `<div className="bg-[#1a73e9]" />`,
    value: 'bg-[#1a73e9]',
    type: 'arbitrary-class',
    expectedToken: 'bg-brand-primary',
  },
];
