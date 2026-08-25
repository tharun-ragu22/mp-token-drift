import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { JSXAttribute, ObjectProperty, StringLiteral } from '@babel/types';

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

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const ARBITRARY_CLASS = /\[[^\]]+\]/;

/**
 * Scan TSX/JSX source for design-token drift: hardcoded inline hex colors in
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

      // className="..." — flag Tailwind arbitrary-value classes like `p-[13px]`.
      if (attrName === 'className' && value?.type === 'StringLiteral') {
        const line = value.loc?.start.line ?? 0;
        for (const token of value.value.split(/\s+/)) {
          if (token && ARBITRARY_CLASS.test(token)) {
            findings.push({ type: 'arbitrary-class', value: token, line });
          }
        }
      }

      // style={{ ... }} — flag hardcoded hex color string literals.
      if (attrName === 'style' && value?.type === 'JSXExpressionContainer') {
        const expr = value.expression;
        if (expr.type === 'ObjectExpression') {
          for (const prop of expr.properties) {
            if (prop.type !== 'ObjectProperty') continue;
            const propValue = (prop as ObjectProperty).value;
            if (propValue.type === 'StringLiteral') {
              const literal = propValue as StringLiteral;
              if (HEX_COLOR.test(literal.value)) {
                findings.push({
                  type: 'hardcoded-color',
                  value: literal.value,
                  line: literal.loc?.start.line ?? 0,
                });
              }
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
