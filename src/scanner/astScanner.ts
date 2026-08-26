import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath, Scope } from '@babel/traverse';
import type { JSXAttribute, Node, ObjectExpression } from '@babel/types';

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

// Hardcoded color literals: hex, rgb()/rgba(), hsl()/hsla(), and oklab()/oklch().
const COLOR_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\brgba?\([^)]*\)/i,
  /\bhsla?\([^)]*\)/i,
  /\bokl(?:ab|ch)\([^)]*\)/i,
];

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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
  // A className is either a bare string or an expression container; walk whichever.
  const root = value?.type === 'JSXExpressionContainer' ? value.expression : value;
  const strings: ClassString[] = [];
  collectClassStrings(root, strings);

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

/** Collect string literals reachable from a style property value, incl. ternaries. */
function collectValueStrings(node: Node | null | undefined, out: ClassString[]): void {
  if (!node) return;

  switch (node.type) {
    case 'StringLiteral':
      out.push({ text: node.value, line: lineOf(node) });
      break;
    case 'ConditionalExpression':
      collectValueStrings(node.consequent, out);
      collectValueStrings(node.alternate, out);
      break;
    case 'LogicalExpression':
      collectValueStrings(node.left, out);
      collectValueStrings(node.right, out);
      break;
    default:
      break;
  }
}

/** Resolve a style prop expression to its object literal, following a simple const identifier. */
function resolveStyleObject(node: Node, scope: Scope): ObjectExpression | null {
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (binding?.path.isVariableDeclarator()) {
      const init = binding.path.node.init;
      if (init?.type === 'ObjectExpression') return init;
    }
  }
  return null;
}

/** Flag hardcoded color literals in an inline `style={{ ... }}` object (or a referenced const). */
function findHardcodedColors(path: NodePath<JSXAttribute>): Finding[] {
  const value = path.node.value;
  if (value?.type !== 'JSXExpressionContainer') return [];

  const object = resolveStyleObject(value.expression, path.scope);
  if (!object) return [];

  const findings: Finding[] = [];
  for (const prop of object.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const strings: ClassString[] = [];
    collectValueStrings(prop.value, strings);
    for (const { text, line } of strings) {
      const color = extractColor(text);
      if (color) {
        findings.push({ type: 'hardcoded-color', value: color, line });
      }
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
  const suppressedLines = collectSuppressedLines(code);

  const findings: Finding[] = [];
  traverse(ast, {
    JSXAttribute(path: NodePath<JSXAttribute>) {
      const attrName = path.node.name.name;
      if (attrName === 'className') {
        findings.push(...findArbitraryClasses(path.node.value));
      } else if (attrName === 'style') {
        findings.push(...findHardcodedColors(path));
      }
    },
  });

  return findings.filter((finding) => !suppressedLines.has(finding.line));
}

/** Line numbers carrying a `drift-ignore` directive; findings on them are suppressed. */
function collectSuppressedLines(code: string): Set<number> {
  const suppressed = new Set<number>();
  code.split('\n').forEach((line, index) => {
    if (line.includes('drift-ignore')) suppressed.add(index + 1);
  });
  return suppressed;
}

export function scanFile(filePath: string): Finding[] {
  let code: string;
  try {
    code = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
  return scanSource(code);
}
