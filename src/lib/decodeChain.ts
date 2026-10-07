import type { DecodeStep } from "./convert/types.ts";

export interface PeelResult {
  /** The innermost text after all layers are removed */
  text: string;
  /** Layers removed, outermost first; empty when the input had no layers */
  steps: DecodeStep[];
  /** The detected format of `text` when peeling already ran detection on it, so the pipeline does not detect twice */
  format: string | null;
}

/**
 * Decode chain: in auto mode, remove encoding layers (Base64, hex, gzip, JWT,
 * URI encoding...) until the text is a structured format. The pipeline then
 * detects and parses the innermost text.
 *
 * STUB: removes nothing. The decode-chain feature replaces this body.
 */
export async function peelLayers(text: string): Promise<PeelResult> {
  return { text, steps: [], format: null };
}

/**
 * Parse a JWT into { header, payload, signature }. Used when the user picks the
 * JWT input format.
 *
 * STUB: throws. The decode-chain feature replaces this body.
 */
export function decodeJwt(_text: string): unknown {
  throw new Error("JWT decoding is not available yet");
}
