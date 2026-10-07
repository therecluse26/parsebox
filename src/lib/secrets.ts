import type { SecretFinding } from "./convert/types.ts";

/**
 * Secret detection: find values that look like API keys, tokens, passwords or
 * private keys in the parsed value. Runs fully in the browser, no network.
 *
 * STUB: finds nothing. The secrets feature replaces this body.
 */
export function scanSecrets(_value: unknown): SecretFinding[] {
  return [];
}

/**
 * Return a copy of `value` with each finding's value masked. Must not change `value`.
 *
 * STUB: returns the value unchanged. The secrets feature replaces this body.
 */
export function redactSecrets(value: unknown, _findings: SecretFinding[]): unknown {
  return value;
}
