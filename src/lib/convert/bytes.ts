/**
 * Bytes ↔ text for the Base64, hex and binary readers and writers. Text is
 * UTF-8 on both sides, so any character round-trips; bytes that are not UTF-8
 * stay bytes (a Uint8Array value) and are written back exactly.
 */

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

/** The UTF-8 text of `bytes`, or null when they are not valid UTF-8 */
export function utf8Text(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export const utf8Bytes = (text: string): Uint8Array => utf8Encoder.encode(text);

/** Base64 or base64url, with or without padding and line breaks. Throws when the text is not Base64. */
export function base64ToBytes(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text.includes("-") || text.includes("_") ? text.replace(/-/g, "+").replace(/_/g, "/") : text);
  } catch {
    throw new Error("not valid Base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Native in newer browsers; the fallbacks fill an ASCII byte buffer and decode it once,
// which is far faster than building the string piece by piece
const native = Uint8Array.prototype as unknown as { toBase64?: () => string; toHex?: () => string };
const ascii = new TextDecoder("latin1");
const B64 = Uint8Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", (c) => c.charCodeAt(0));

export function bytesToBase64(bytes: Uint8Array): string {
  if (native.toBase64) return native.toBase64.call(bytes);
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = B64[v >> 18];
    out[o++] = B64[(v >> 12) & 63];
    out[o++] = B64[(v >> 6) & 63];
    out[o++] = B64[v & 63];
  }
  if (i < n) {
    const v = (bytes[i] << 16) | (i + 1 < n ? bytes[i + 1] << 8 : 0);
    out[o++] = B64[v >> 18];
    out[o++] = B64[(v >> 12) & 63];
    out[o++] = i + 1 < n ? B64[(v >> 6) & 63] : 0x3d;
    out[o++] = 0x3d;
  }
  return ascii.decode(out);
}

/** Hex digits, whitespace between them is ignored. Throws on any other character or an odd digit count. */
export function hexToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length >> 1);
  let n = 0;
  let high = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    const digit = c >= 0x30 && c <= 0x39 ? c - 0x30 : (c | 0x20) >= 0x61 && (c | 0x20) <= 0x66 ? (c | 0x20) - 0x57 : -1;
    if (digit < 0) throw new Error(`not a hex digit: "${text[i]}" at position ${i}`);
    if (high < 0) {
      high = digit;
    } else {
      bytes[n++] = (high << 4) | digit;
      high = -1;
    }
  }
  if (high >= 0) throw new Error("hex input has an odd number of digits");
  return bytes.subarray(0, n);
}

export function bytesToHex(bytes: Uint8Array): string {
  if (native.toHex) return native.toHex.call(bytes);
  const out = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = HEX_PAIRS[bytes[i]];
  return ascii.decode(new Uint8Array(out.buffer));
}

/** Groups of 0 and 1, whitespace between them is ignored. Throws on any other character or a partial byte. */
export function binaryToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length >> 3);
  let n = 0;
  let byte = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c !== 0x30 && c !== 0x31) throw new Error(`not a binary digit: "${text[i]}" at position ${i}`);
    byte = (byte << 1) | (c - 0x30);
    if (++bits === 8) {
      bytes[n++] = byte;
      byte = bits = 0;
    }
  }
  if (bits !== 0) throw new Error("binary input is not a whole number of 8-bit bytes");
  return bytes.subarray(0, n);
}

/** Bytes as 8-bit groups separated by spaces */
export function bytesToBinary(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const out = new Uint8Array(bytes.length * 9 - 1).fill(0x20);
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    const o = i * 9;
    for (let bit = 0; bit < 8; bit++) out[o + bit] = 0x30 | ((byte >> (7 - bit)) & 1);
  }
  return ascii.decode(out);
}

// Two hex digits per byte as one 16-bit unit, low byte first, so the buffer reads in order on little-endian machines
const HEX_PAIRS = Uint16Array.from({ length: 256 }, (_, i) => {
  const hex = i.toString(16).padStart(2, "0");
  return hex.charCodeAt(0) | (hex.charCodeAt(1) << 8);
});
