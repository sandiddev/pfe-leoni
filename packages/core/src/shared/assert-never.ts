/**
 * Compile-time exhaustiveness guard for discriminated unions.
 *
 * Placing this in the `default` branch of a `switch` turns "someone added a new
 * request status and forgot to handle it here" from a runtime surprise into a
 * type error at the call site.
 */
export function assertNever(value: never, context?: string): never {
  const description = context === undefined ? "" : ` in ${context}`;
  throw new Error(`Unhandled case${description}: ${JSON.stringify(value)}`);
}
