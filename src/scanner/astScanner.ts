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

interface SourceString {
  text: string;
  line: number;
}

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

/**
 * Recursively gather static string segments from an expression tree: plain
 * strings, template literals (static quasis plus interpolations), the
 * conditional/logical/binary expressions used to toggle values, utility-call
 * arguments (cn/clsx), and object keys (clsx's object form). Both the class and
 * color scanners share this collection step and differ only in how they
 * classify the results.
 */
function collectStrings(node: Node | null | undefined, out: SourceString[]): void {
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
        collectStrings(expression, out);
      }
      break;
    case 'ConditionalExpression':
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      break;
    case 'LogicalExpression':
    case 'BinaryExpression':
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      break;
    case 'CallExpression':
    case 'OptionalCallExpression':
      // Utility helpers like cn(...) / clsx(...): the values live in the args.
      for (const argument of node.arguments) {
        collectStrings(argument, out);
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
  const strings: SourceString[] = [];
  collectStrings(root, strings);

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
    const strings: SourceString[] = [];
    collectStrings(prop.value, strings);
    for (const { text, line } of strings) {
      const color = extractColor(text);
      if (color) {
        findings.push({ type: 'hardcoded-color', value: color, line });
      }
    }
  }
  return findings;
}

// A suppression directive: `drift-ignore` or `drift-disable`, in a line or block comment.
const SUPPRESS_DIRECTIVE = /drift-(?:ignore|disable)/;

/**
 * Line numbers whose findings should be suppressed. A directive suppresses both
 * its own line (inline, e.g. `color: '#fff', // drift-ignore`) and the line that
 * follows it (a comment placed on the line preceding the finding).
 */
function collectSuppressedLines(code: string): Set<number> {
  const suppressed = new Set<number>();
  code.split('\n').forEach((line, index) => {
    if (SUPPRESS_DIRECTIVE.test(line)) {
      suppressed.add(index + 1); // the directive's own line
      suppressed.add(index + 2); // and the finding on the following line
    }
  });
  return suppressed;
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
