/**
 * Shared AST helpers for Layer 2 static scorers.
 *
 * Uses the TypeScript compiler API directly (already a project dep) —
 * we don't need ESLint's full AST surface for the rules Layer 2
 * checks, and avoiding @typescript-eslint/parser keeps the
 * dependency surface lean.
 *
 * Each helper reads/parses on demand. There's no caching layer; the
 * scorer stack runs once per scenario and we're scanning maybe a
 * dozen files, so re-parsing is cheaper than building a cache.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as ts from 'typescript';

const SCAN_EXTS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

export function isScannable(filePath: string): boolean {
  return SCAN_EXTS.has(extname(filePath));
}

/**
 * Parse a file into a TypeScript SourceFile. Returns `undefined` if
 * the file can't be read — caller decides how to surface that to the
 * scorer (typically: skip, don't fail).
 */
export function parseFile(absPath: string): ts.SourceFile | undefined {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
  const isTsx = absPath.endsWith('.tsx') || absPath.endsWith('.jsx');
  return ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** What an `import` statement contributes to scope. */
export interface ImportRecord {
  specifier: string;
  defaultImport?: string;
  namespace?: string;
  namedImports: string[];
}

/**
 * Collect every static `import` declaration in the source. CommonJS
 * `require()` calls are also picked up (top-level only) so the scorer
 * works for `.cjs` files too.
 */
export function collectImports(source: ts.SourceFile): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const stmt of source.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const rec: ImportRecord = {
        specifier: stmt.moduleSpecifier.text,
        namedImports: [],
      };
      const clause = stmt.importClause;
      if (clause) {
        if (clause.name) rec.defaultImport = clause.name.text;
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            rec.namespace = clause.namedBindings.name.text;
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              rec.namedImports.push(el.name.text);
            }
          }
        }
      }
      records.push(rec);
      continue;
    }
    // require('...') at top level — `const x = require('foo')` or
    // bare `require('foo')`.
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === 'require' &&
          decl.initializer.arguments.length === 1 &&
          ts.isStringLiteral(decl.initializer.arguments[0])
        ) {
          records.push({
            specifier: decl.initializer.arguments[0].text,
            namedImports: [],
            defaultImport: ts.isIdentifier(decl.name)
              ? decl.name.text
              : undefined,
          });
        }
      }
    }
  }
  return records;
}

/**
 * Detect the "use client" / "use server" directive prologue.
 * Matches the React 19 / Next.js 13+ contract: a leading string-
 * literal expression statement whose value is exactly "use client"
 * or "use server".
 */
export function getDirective(
  source: ts.SourceFile,
): 'use client' | 'use server' | undefined {
  for (const stmt of source.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      const v = stmt.expression.text;
      if (v === 'use client' || v === 'use server') return v;
      // Stop at the first non-directive statement — directives must
      // appear in the prologue.
      continue;
    }
    break;
  }
  return undefined;
}

/**
 * Find every call to a function by simple name (no member access).
 * Used to locate `init(...)`, `track(...)`, etc. Returns AST nodes;
 * caller can inspect arguments / parents.
 */
export function findCallsByName(
  source: ts.SourceFile,
  name: string,
): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  function walk(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      out.push(node);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  return out;
}

/**
 * Return true if the call expression sits at the top-level module
 * scope (not inside a function, class, block, etc.) — useful for
 * "init() must not run at module scope of a Server Component."
 */
export function isAtModuleScope(
  call: ts.CallExpression,
  source: ts.SourceFile,
): boolean {
  let parent: ts.Node | undefined = call.parent;
  while (parent && parent !== source) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isBlock(parent) ||
      ts.isIfStatement(parent) ||
      ts.isForStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isTryStatement(parent)
    ) {
      return false;
    }
    parent = parent.parent;
  }
  return true;
}
