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

/**
 * The dataset deliberately spans the full spread of drift the tool handles, not
 * just one axis:
 *   - hardcoded colors across notations (hex, short hex, hsl(), rgba(), oklch())
 *     and CSS properties (color, backgroundColor, borderColor, outlineColor),
 *     resolving to every color token including `warning`;
 *   - arbitrary spacing utilities across prefixes (p/px/gap/py) and a negative
 *     margin (-mt);
 *   - arbitrary radius utilities routed to the radius scale (sm/md/lg);
 *   - arbitrary bracketed-color utilities across prefixes (bg/text/border/ring/
 *     fill) that map to a prefixed color token.
 */
export const evalDataset: EvalCase[] = [
  // ── Hardcoded colors: hex near-misses ──────────────────────────────────────
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
    jsx: `<div style={{ backgroundColor: '#f8ab01' }} />`,
    value: '#f8ab01',
    type: 'hardcoded-color',
    expectedToken: 'warning',
  },

  // ── Hardcoded colors: non-hex notations (hsl / rgba / oklch) ────────────────
  {
    jsx: `<a style={{ color: 'hsl(214, 82%, 51%)' }}>Link</a>`,
    value: 'hsl(214, 82%, 51%)',
    type: 'hardcoded-color',
    expectedToken: 'brand-primary',
  },
  {
    jsx: `<div style={{ borderColor: 'rgba(217, 48, 37, 0.9)' }} />`,
    value: 'rgba(217, 48, 37, 0.9)',
    type: 'hardcoded-color',
    expectedToken: 'danger',
  },
  {
    jsx: `<span style={{ color: 'hsl(136, 68%, 30%)' }}>Ok</span>`,
    value: 'hsl(136, 68%, 30%)',
    type: 'hardcoded-color',
    expectedToken: 'brand-secondary',
  },
  {
    jsx: `<div style={{ outlineColor: 'oklch(0.63 0.2 27)' }} />`,
    value: 'oklch(0.63 0.2 27)',
    type: 'hardcoded-color',
    expectedToken: 'danger',
  },

  // ── Arbitrary spacing utilities (varied prefixes, incl. negative margin) ────
  {
    jsx: `<div className="p-[13px]" />`,
    value: 'p-[13px]',
    type: 'arbitrary-class',
    expectedToken: 'p-3',
  },
  {
    jsx: `<div className="px-[5px]" />`,
    value: 'px-[5px]',
    type: 'arbitrary-class',
    expectedToken: 'px-1',
  },
  {
    jsx: `<div className="gap-[7px]" />`,
    value: 'gap-[7px]',
    type: 'arbitrary-class',
    expectedToken: 'gap-2',
  },
  {
    jsx: `<div className="py-[23px]" />`,
    value: 'py-[23px]',
    type: 'arbitrary-class',
    expectedToken: 'py-6',
  },
  {
    jsx: `<div className="-mt-[9px]" />`,
    value: '-mt-[9px]',
    type: 'arbitrary-class',
    expectedToken: '-mt-2',
  },

  // ── Arbitrary radius utilities (routed to the radius scale) ─────────────────
  {
    jsx: `<div className="rounded-[7px]" />`,
    value: 'rounded-[7px]',
    type: 'arbitrary-class',
    expectedToken: 'rounded-md',
  },
  {
    jsx: `<div className="rounded-[3px]" />`,
    value: 'rounded-[3px]',
    type: 'arbitrary-class',
    expectedToken: 'rounded-sm',
  },
  {
    jsx: `<div className="rounded-[11px]" />`,
    value: 'rounded-[11px]',
    type: 'arbitrary-class',
    expectedToken: 'rounded-lg',
  },

  // ── Arbitrary bracketed-color utilities (varied prefixes) ───────────────────
  {
    jsx: `<div className="bg-[#1a73e9]" />`,
    value: 'bg-[#1a73e9]',
    type: 'arbitrary-class',
    expectedToken: 'bg-brand-primary',
  },
  {
    jsx: `<span className="text-[#1a73e8]">Heading</span>`,
    value: 'text-[#1a73e8]',
    type: 'arbitrary-class',
    expectedToken: 'text-brand-primary',
  },
  {
    jsx: `<div className="border-[#d93025]" />`,
    value: 'border-[#d93025]',
    type: 'arbitrary-class',
    expectedToken: 'border-danger',
  },
  {
    jsx: `<div className="ring-[#f9ab00]" />`,
    value: 'ring-[#f9ab00]',
    type: 'arbitrary-class',
    expectedToken: 'ring-warning',
  },
  {
    jsx: `<svg className="fill-[#188038]" />`,
    value: 'fill-[#188038]',
    type: 'arbitrary-class',
    expectedToken: 'fill-brand-secondary',
  },
];
