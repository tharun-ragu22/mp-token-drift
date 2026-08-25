import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { JSXAttribute, Node, ObjectProperty } from '@babel/types';

// @babel/traverse ships as CommonJS. Under NodeNext's typing the callable sits
// on `.default`; some bundlers (e.g. Vitest/esbuild) hand back the function
// directly, so fall back to the namespace object itself.
type TraverseFn = typeof babelTraverse.default;
const traverse: TraverseFn = babelTraverse.default ?? (babelTraverse as unknown as TraverseFn);

export type FindingType = 'hardcoded-color' | 'arbitrary-class';

export interface Finding {
  type: FindingType;
  value: string;
  line: number;
}

// Tailwind arbitrary-value syntax, e.g. `p-[13px]`, `bg-[#f0f0f0]`.
const ARBITRARY_CLASS = /\[[^\]]+\]/;

// Hardcoded color literals: hex (#f00 / #ffffff / #ffffffff), rgb()/rgba(), hsl()/hsla().
const COLOR_PATTERNS = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\([^)]*\)/i, /\bhsla?\([^)]*\)/i];

function isHardcodedColor(value: string): boolean {
  return COLOR_PATTERNS.some((re) => re.test(value));
}

interface ClassString {
  text: string;
  line: number;
}

/**
 * Recursively collect the static string segments that make up a `className`
 * value. Handles plain string literals, template literals (both their static
 * quasis and interpolated expressions), and the conditional/logical
 * expressions commonly used to toggle classes.
 */
function collectClassStrings(node: Node | null | undefined, out: ClassString[]): void {
  if (!node) return;

  switch (node.type) {
    case 'StringLiteral':
      out.push({ text: node.value, line: node.loc?.start.line ?? 0 });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) {
        out.push({
          text: quasi.value.cooked ?? quasi.value.raw,
          line: quasi.loc?.start.line ?? 0,
        });
      }
      for (const expression of node.expressions) {
        collectClassStrings(expression, out);
      }
      break;
    case 'ConditionalExpression':
      collectClassStrings(node.consequent, out);
      collectClassStrings(node.alternate, out);
      break;
    case 'LogicalExpression':
    case 'BinaryExpression':
      collectClassStrings(node.left, out);
      collectClassStrings(node.right, out);
      break;
    default:
      break;
  }
}

/**
 * Scan TSX/JSX source for design-token drift: hardcoded color literals in
 * `style` props and arbitrary-value Tailwind classes in `className`.
 */
export function scanSource(code: string): Finding[] {
  const findings: Finding[] = [];

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  traverse(ast, {
    JSXAttribute(path: NodePath<JSXAttribute>) {
      const attrName = path.node.name.name;
      const value = path.node.value;

      // className="..." or className={...} — flag Tailwind arbitrary-value classes.
      if (attrName === 'className') {
        const strings: ClassString[] = [];
        if (value?.type === 'StringLiteral') {
          collectClassStrings(value, strings);
        } else if (value?.type === 'JSXExpressionContainer') {
          collectClassStrings(value.expression, strings);
        }

        for (const { text, line } of strings) {
          for (const token of text.split(/\s+/)) {
            if (token && ARBITRARY_CLASS.test(token)) {
              findings.push({ type: 'arbitrary-class', value: token, line });
            }
          }
        }
      }

      // style={{ ... }} — flag hardcoded color string literals (any CSS property).
      if (attrName === 'style' && value?.type === 'JSXExpressionContainer') {
        const expr = value.expression;
        if (expr.type === 'ObjectExpression') {
          for (const prop of expr.properties) {
            if (prop.type !== 'ObjectProperty') continue;
            const propValue = (prop as ObjectProperty).value;
            if (propValue.type === 'StringLiteral' && isHardcodedColor(propValue.value)) {
              findings.push({
                type: 'hardcoded-color',
                value: propValue.value,
                line: propValue.loc?.start.line ?? 0,
              });
            }
          }
        }
      }
    },
  });

  return findings;
}

export function scanFile(filePath: string): Finding[] {
  const code = readFileSync(filePath, 'utf8');
  return scanSource(code);
}
