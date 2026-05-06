/**
 * Compile-time exhaustiveness check for discriminated unions.
 *
 * Call from the `default` case of a switch on a union's discriminant
 * (or after an if-chain that returns from each arm). TypeScript
 * narrows the variable to `never` only if every variant has been
 * handled — adding a new variant produces a type error that points at
 * every call site, forcing review.
 *
 * Throws at runtime if reached, but the compile-time check is the
 * primary purpose. The throw is defense-in-depth for cases where the
 * narrowing is somehow bypassed (e.g. a value produced by JSON parse
 * with an unexpected discriminant).
 *
 * @example
 *   switch (result.kind) {
 *     case 'success': ... break;
 *     case 'error':   ... break;
 *     default: assertNever(result);
 *   }
 */
export function assertNever(value: never): never {
  throw new Error(
    `assertNever: unexpected value ${JSON.stringify(value)}`,
  );
}
