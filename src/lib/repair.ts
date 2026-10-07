import type { ParseErrorInfo, RepairInfo } from "./convert/types.ts";

/**
 * Repair mode: fix almost-valid JSON (trailing commas, single quotes, Python
 * constants, comments). The pipeline calls this only after normal parsing fails.
 *
 * STUB: returns null. The repair feature replaces this body.
 */
export function tryRepair(_text: string): { value: unknown; info: RepairInfo } | null {
  return null;
}

/**
 * Error help: turn a parser error into a message with a 1-based line and column
 * and, when cheap, a short hint. Must not parse the text again.
 *
 * STUB: returns the message only. The error-help feature replaces this body.
 */
export function describeParseError(error: unknown, _text: string, _format: string): ParseErrorInfo {
  return { message: error instanceof Error ? error.message : String(error) };
}
