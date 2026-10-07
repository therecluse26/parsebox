import type { LossReport } from "./convert/types.ts";

/**
 * Conversion loss report: list what the output format cannot keep from the
 * parsed value (nesting, types, nulls, comments...). Must be one linear walk at
 * most, and no walk at all when the output format keeps everything.
 *
 * STUB: reports nothing. The loss-report feature replaces this body.
 */
export function collectLosses(_value: unknown, _inputFormat: string, _outputFormat: string): LossReport | null {
  return null;
}
