import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { JSXAttribute, Node } from '@babel/types';

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

type AttributeValue = JSXAttribute['value'];

// Tailwind arbitrary-value syntax, e.g. `p-[13px]`, `bg-[#f0f0f0]`.
const ARBITRARY_CLASS = /\[[^\]]+\]/;

// Hardcoded color literals: hex (#f00 / #ffffff / #ffffffff), rgb()/rgba(), hsl()/hsla().
const COLOR_PATTERNS = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\([^)]*\)/i, /\bhsla?\([^)]*\)/i];

// Return the first hardcoded color found in a value, or null. Extracting the
// match (rather than the whole value) resolves CSS variable fallbacks such as
// `var(--my-color, #ff0055)` down to the literal color they hide.
function extractColor(value: string): string | null {
  for (const pattern of COLOR_PATTERNS) {
    const match = pattern.exec(value);
    if (match) return match[0] ?? null;
  }
  return null;
}

function lineOf(node: Node): number {
  return node.loc?.start.line ?? 0;
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
      out.push({ text: node.value, line: lineOf(node) });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) {
        out.push({ text: quasi.value.cooked ?? quasi.value.raw, line: lineOf(quasi) });
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
    case 'CallExpression':
    case 'OptionalCallExpression':
      // Utility helpers like cn(...) / clsx(...): the class names live in the args.
      for (const argument of node.arguments) {
        collectClassStrings(argument, out);
      }
      break;
    case 'ObjectExpression':
      // clsx object form, e.g. clsx({ 'bg-[#123456]': active }): keys are classes.
      for (const property of node.properties) {
        if (property.type === 'ObjectProperty' && property.key.type === 'StringLiteral') {
          out.push({ text: property.key.value, line: lineOf(property.key) });
        }
      }
      break;
    default:
      break;
  }
}

/** Flag Tailwind arbitrary-value classes (e.g. `p-[13px]`) within a `className`. */
function findArbitraryClasses(value: AttributeValue): Finding[] {
  const strings: ClassString[] = [];
  if (value?.type === 'StringLiteral') {
    collectClassStrings(value, strings);
  } else if (value?.type === 'JSXExpressionContainer') {
    collectClassStrings(value.expression, strings);
  }

  const findings: Finding[] = [];
  for (const { text, line } of strings) {
    for (const token of text.split(/\s+/)) {
      if (token && ARBITRARY_CLASS.test(token)) {
        findings.push({ type: 'arbitrary-class', value: token, line });
      }
    }
  }
  return findings;
}

/** Flag hardcoded color literals in an inline `style={{ ... }}` object. */
function findHardcodedColors(value: AttributeValue): Finding[] {
  if (value?.type !== 'JSXExpressionContainer' || value.expression.type !== 'ObjectExpression') {
    return [];
  }

  const findings: Finding[] = [];
  for (const prop of value.expression.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const propValue = prop.value;
    if (propValue.type !== 'StringLiteral') continue;
    const color = extractColor(propValue.value);
    if (color) {
      findings.push({ type: 'hardcoded-color', value: color, line: lineOf(propValue) });
    }
  }
  return findings;
}

/**
 * Scan TSX/JSX source for design-token drift: hardcoded color literals in
 * `style` props and arbitrary-value Tailwind classes in `className`.
 */
export function scanSource(code: string): Finding[] {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const findings: Finding[] = [];
  traverse(ast, {
    JSXAttribute(path: NodePath<JSXAttribute>) {
      const attrName = path.node.name.name;
      if (attrName === 'className') {
        findings.push(...findArbitraryClasses(path.node.value));
      } else if (attrName === 'style') {
        findings.push(...findHardcodedColors(path.node.value));
      }
    },
  });

  return findings;
}

export function scanFile(filePath: string): Finding[] {
  let code: string;
  try {
    code = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
  return scanSource(code);
}
