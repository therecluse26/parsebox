import type { DecodeStep } from "./convert/types.ts";
import { LIMITS } from "../config/limits.ts";
import { detectFormat } from "./detectFormat.ts";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { bytesToBase64 } from "./convert/bytes.ts";

export interface PeelResult {
  /** The innermost text after all layers are removed */
  text: string;
  /** Layers removed, outermost first; empty when the input had no layers */
  steps: DecodeStep[];
  /** The detected format of `text` when peeling already ran detection on it, so the pipeline does not detect twice */
  format: string | null;
}

export interface PeelOptions {
  /** Defaults to LIMITS.decodeMaxDepth */
  maxDepth?: number;
  /** Defaults to LIMITS.decompressMaxBytes */
  decompressMaxBytes?: number;
}

/**
 * Decode chain: in auto mode, remove encoding layers (Base64, hex, gzip, JWT,
 * URI encoding...) until the text is a structured format. Returns the innermost
 * text and its detected format, so the pipeline does not detect again.
 *
 * Every check is linear and most inputs are rejected by their first character,
 * so plain input costs one detectFormat call and nothing more.
 *
 * Throws when a compressed layer expands past the size cap, or when a longer
 * compressed layer is corrupt (a short one is more likely random text).
 */
export async function peelLayers(text: string, options: PeelOptions = {}): Promise<PeelResult> {
  const budget: Budget = {
    depth: options.maxDepth ?? LIMITS.decodeMaxDepth,
    maxBytes: options.decompressMaxBytes ?? LIMITS.decompressMaxBytes,
  };
  const steps: DecodeStep[] = [];
  let current = text;
  let format: string | null = null;

  while (budget.depth > 0) {
    const layer = await peelOne(current, budget);
    if (!layer) break;
    steps.push(...layer.steps);
    budget.depth -= layer.steps.length;
    current = layer.text;
    format = layer.format;
  }
  return { text: current, steps, format: format ?? detectFormat(current) };
}

/**
 * Parse a JWT into { header, payload, signature }. Used when the user picks the
 * JWT input format. When the payload has numeric `exp`, `iat` or `nbf` claims, a
 * separate `dates` field shows them as ISO dates; the payload itself is unchanged.
 */
export function decodeJwt(text: string): JwtParts {
  const parts = text.trim().split(".");
  if (parts.length !== 3) {
    throw new Error(`A JWT has 3 parts separated by dots, but this has ${parts.length}`);
  }
  const [header, payload, signature] = parts;
  const result: JwtParts = {
    header: jwtSegment(header, "header"),
    payload: jwtSegment(payload, "payload"),
    signature,
  };
  if (signature !== "" && !isBase64Url(signature)) {
    throw new Error("The JWT signature is not valid base64url");
  }
  const dates = claimDates(result.payload);
  if (dates) result.dates = dates;
  return result;
}

export interface JwtParts {
  header: unknown;
  payload: unknown;
  /** The raw base64url signature */
  signature: string;
  /** ISO dates of the numeric exp, iat and nbf claims, when present */
  dates?: Record<string, string>;
}

interface Budget {
  /** Layers that may still be removed */
  depth: number;
  maxBytes: number;
}

interface Layer {
  text: string;
  steps: DecodeStep[];
  /** The detected format of `text`, when already known */
  format: string | null;
}

const STEP = {
  jwt: { layer: "jwt", label: "JWT" },
  jsonString: { layer: "json-string", label: "json string" },
  base64: { layer: "base64", label: "Base64" },
  hex: { layer: "hex", label: "hex" },
  binary: { layer: "binary", label: "binary" },
  uri: { layer: "uri", label: "URI" },
  gzip: { layer: "gzip", label: "gzip" },
  zlib: { layer: "deflate", label: "zlib" },
} satisfies Record<string, DecodeStep>;

const JSON_FORMATS = new Set(["json", "json5", "jsonl"]);
const MARKUP_FORMATS = new Set(["json", "json5", "jsonl", "xml"]);

/** Encoded text below this many characters needs more proof, so short words and numbers stay text */
const SHORT_ENCODED = 32;

/** Readability is checked on this many leading characters of decoded text */
const READABLE_SAMPLE = 65_536;

async function peelOne(text: string, budget: Budget): Promise<Layer | null> {
  const trimmed = text.trim();
  const first = trimmed.charCodeAt(0);
  // Structured text (JSON, XML) and empty input: no layer. This keeps plain input free.
  if (Number.isNaN(first) || first === 0x7b || first === 0x5b || first === 0x3c) return null;

  if (first === 0x22) return peelJsonString(trimmed, budget.depth);
  if (trimmed.startsWith("eyJ")) {
    const jwt = peelJwt(trimmed);
    if (jwt) return jwt;
  }

  const shape = scanShape(trimmed);
  // Numbers that happen to decode must decode to JSON or XML; short text must also pass detectFormat
  const short: Proof = trimmed.length < SHORT_ENCODED ? "agree" : "none";
  if (shape.binary) {
    const layer = await peelBytes(trimmed, STEP.binary, binaryBytes(trimmed), short, budget);
    if (layer) return layer;
  }
  if (shape.hex) {
    const proof = shape.hexLetters ? short : "markup";
    const layer = await peelBytes(trimmed, STEP.hex, hexBytes(trimmed), proof, budget);
    if (layer) return layer;
  }
  if (shape.base64) {
    const proof = shape.letters ? short : "markup";
    const layer = await peelBytes(trimmed, STEP.base64, base64Bytes(trimmed, shape.base64Url), proof, budget);
    if (layer) return layer;
  }
  // Query strings also contain %XX; detectFormat tells them apart
  if (shape.uri && detectFormat(trimmed) === "uri") {
    try {
      return { text: decodeURIComponent(trimmed), steps: [STEP.uri], format: null };
    } catch {
      return null;
    }
  }
  return null;
}

interface Shape {
  /** Only 0, 1 and whitespace, in 8-bit groups */
  binary: boolean;
  /** Only hex digits and whitespace, an even count */
  hex: boolean;
  /** Has a hex digit a-f (exact when `hex` is true) */
  hexLetters: boolean;
  /** Has a letter (exact when `base64` is true) */
  letters: boolean;
  /** Only Base64 characters and line breaks, one alphabet */
  base64: boolean;
  /** Uses the base64url alphabet (- and _) */
  base64Url: boolean;
  /** No whitespace and at least one %XX escape */
  uri: boolean;
}

// One pass over the text that stops as soon as no encoding can match
function scanShape(text: string): Shape {
  let binary = true;
  let hex = true;
  let base64 = true;
  let uri = true;
  let percent = false;
  let standard = false;
  let url = false;
  let hexLetters = false;
  let letters = false;
  let digits = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x30 || c === 0x31) {
      digits++;
    } else if (c >= 0x32 && c <= 0x39) {
      binary = false;
      digits++;
    } else if ((c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)) {
      binary = false;
      hexLetters = letters = true;
      digits++;
    } else if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) {
      binary = hex = false;
      letters = true;
    } else if (c === 0x0a || c === 0x0d) {
      uri = false;
    } else if (c === 0x20 || c === 0x09) {
      // Hex dumps and bit groups use spaces; Base64 wraps with line breaks only
      base64 = uri = false;
    } else if (c === 0x2b || c === 0x2f) {
      binary = hex = false;
      standard = true;
    } else if (c === 0x2d || c === 0x5f) {
      binary = hex = false;
      url = true;
    } else if (c === 0x3d) {
      binary = hex = false;
    } else if (c === 0x25) {
      binary = hex = base64 = false;
      if (isHexDigit(text.charCodeAt(i + 1)) && isHexDigit(text.charCodeAt(i + 2))) percent = true;
    } else if (c <= 0x20) {
      return { binary: false, hex: false, hexLetters: false, letters: false, base64: false, base64Url: false, uri: false };
    } else {
      binary = hex = base64 = false;
    }
    if (!binary && !hex && !base64 && !uri) break;
  }
  return {
    binary: binary && digits >= 8 && digits % 8 === 0,
    hex: hex && digits >= 2 && digits % 2 === 0,
    hexLetters,
    letters,
    base64: base64 && !(standard && url),
    base64Url: url,
    uri: uri && percent,
  };
}

const isHexDigit = (c: number) =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46);

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * How sure an uncompressed decode must be. "none": readable UTF-8 is enough.
 * "agree": detectFormat must also call the encoded text this encoding, and the
 * decoded text must be mostly ASCII. "markup": the decoded text must be JSON or
 * XML. Any decode that gives JSON or XML is accepted.
 */
type Proof = "none" | "agree" | "markup";

/**
 * Turn decoded bytes into the next layer: decompress gzip/zlib, then decode
 * UTF-8. Returns null when the bytes are binary (not UTF-8), so the encoded
 * text stays as it is.
 */
async function peelBytes(
  encoded: string,
  step: DecodeStep,
  decoded: Uint8Array | null,
  proof: Proof,
  budget: Budget
): Promise<Layer | null> {
  if (!decoded || decoded.length === 0) return null;
  const steps: DecodeStep[] = [step];
  let bytes = decoded;
  let compressed = false;

  for (let kind = compression(bytes); kind; kind = compression(bytes)) {
    // The encoding and every compression layer must fit in the depth budget
    if (steps.length >= budget.depth) return null;
    const inflated = await decompress(bytes, kind, budget.maxBytes);
    if (!inflated) return null;
    bytes = inflated;
    steps.push(kind === "gzip" ? STEP.gzip : STEP.zlib);
    compressed = true;
  }

  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    if (!compressed) return null;
    // Decompressed bytes that are not text: MessagePack when they decode as it, otherwise
    // raw bytes. Both go on as Base64, which is what their readers take.
    return { text: bytesToBase64(bytes), steps, format: isMsgpack(bytes) ? "msgpack" : "base64" };
  }
  if (compressed) return { text, steps, format: null };

  // Without compression, guard against words and numbers that happen to decode
  if (!isReadable(text)) return null;
  if (proof === "none") return { text, steps, format: null };

  const first = text.trimStart().charCodeAt(0);
  if (first === 0x7b || first === 0x5b || first === 0x3c) {
    const format = detectFormat(text);
    if (MARKUP_FORMATS.has(format)) return { text, steps, format };
  }
  if (proof === "agree" && encoded.length >= 12 && looksLikeWords(text) && detectFormat(encoded) === step.layer) {
    return { text, steps, format: null };
  }
  return null;
}

// A whole MessagePack document holding an object or array (a lone number or string is too easy to hit by chance)
function isMsgpack(bytes: Uint8Array): boolean {
  try {
    const value = msgpackDecode(bytes);
    return typeof value === "object" && value !== null && !ArrayBuffer.isView(value);
  } catch {
    return false;
  }
}

// Short decoded text: printable ASCII and at least 80% letters, digits and whitespace, so random bytes are rejected
function looksLikeWords(text: string): boolean {
  let word = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7e) return false;
    const lower = c | 0x20;
    if ((lower >= 0x61 && lower <= 0x7a) || (c >= 0x30 && c <= 0x39) || c <= 0x20) word++;
  }
  return word >= text.length * 0.8;
}

// No control characters other than tab and line breaks in the leading sample
function isReadable(text: string): boolean {
  const end = Math.min(text.length, READABLE_SAMPLE);
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return false;
  }
  return end > 0;
}

function compression(bytes: Uint8Array): "gzip" | "deflate" | null {
  // The smallest gzip stream is 18 bytes and the smallest zlib stream 8
  if (bytes.length >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return "gzip";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x78 &&
    (bytes[1] === 0x01 || bytes[1] === 0x5e || bytes[1] === 0x9c || bytes[1] === 0xda)
  ) {
    return "deflate";
  }
  return null;
}

const formatMegabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** Compressed data at least this long that fails to decompress is reported, not skipped */
const CORRUPT_REPORT_BYTES = 128;

/**
 * Stream-decompress, stopping as soon as the output passes maxBytes (zip-bomb
 * guard). Returns null for short data that is not valid: the magic bytes were
 * probably chance.
 */
async function decompress(
  bytes: Uint8Array,
  kind: "gzip" | "deflate",
  maxBytes: number
): Promise<Uint8Array | null> {
  const name = kind === "gzip" ? "gzip" : "zlib";
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(kind));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) break;
      chunks.push(value);
    }
  } catch {
    if (bytes.length < CORRUPT_REPORT_BYTES) return null;
    throw new Error(`The ${name} data is corrupt or truncated`);
  }
  if (total > maxBytes) {
    await reader.cancel().catch(() => {});
    throw new Error(`The ${name} data expands to more than ${formatMegabytes(maxBytes)}. Stopped to protect the browser.`);
  }

  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// --- Encodings ---

function binaryBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 3);
  let n = 0;
  let byte = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 0x30 && c !== 0x31) continue;
    byte = (byte << 1) | (c - 0x30);
    if (++bits === 8) {
      out[n++] = byte;
      byte = bits = 0;
    }
  }
  return out.subarray(0, n);
}

function hexValue(c: number): number {
  if (c <= 0x39) return c - 0x30;
  return (c | 0x20) - 0x57;
}

function hexBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 1);
  let n = 0;
  let high = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x20) continue;
    if (high < 0) {
      high = hexValue(c);
    } else {
      out[n++] = (high << 4) | hexValue(c);
      high = -1;
    }
  }
  return out.subarray(0, n);
}

type FromBase64 = (text: string, options: { alphabet: string; lastChunkHandling: string }) => Uint8Array;
const fromBase64 = (Uint8Array as unknown as { fromBase64?: FromBase64 }).fromBase64;

/** Forgiving Base64 decode: line breaks, missing padding and the base64url alphabet are fine. Null when invalid. */
function base64Bytes(text: string, url: boolean): Uint8Array | null {
  try {
    if (fromBase64) {
      return fromBase64(text, { alphabet: url ? "base64url" : "base64", lastChunkHandling: "loose" });
    }
    const binary = atob(url ? text.replace(/-/g, "+").replace(/_/g, "/") : text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function isBase64Url(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      c === 0x2d ||
      c === 0x5f ||
      c === 0x3d;
    if (!ok) return false;
  }
  return text.length % 4 !== 1;
}

function base64UrlText(segment: string): string | null {
  if (!segment || !isBase64Url(segment)) return null;
  const bytes = base64Bytes(segment.replace(/=+$/, ""), true);
  if (!bytes) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

// --- JWT ---

function jwtSegment(segment: string, name: "header" | "payload"): unknown {
  const text = base64UrlText(segment);
  if (text === null) throw new Error(`The JWT ${name} is not valid base64url`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The JWT ${name} is not JSON`);
  }
}

function claimDates(payload: unknown): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const claims = payload as Record<string, unknown>;
  const dates: Record<string, string> = {};
  for (const claim of ["iat", "nbf", "exp"]) {
    const seconds = claims[claim];
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) continue;
    const date = new Date(seconds * 1000);
    if (!Number.isNaN(date.getTime())) dates[claim] = date.toISOString();
  }
  return Object.keys(dates).length ? dates : null;
}

// Anchored check: exactly three base64url segments, and a JSON header with "alg"
function peelJwt(text: string): Layer | null {
  const firstDot = text.indexOf(".");
  const secondDot = firstDot < 0 ? -1 : text.indexOf(".", firstDot + 1);
  if (secondDot < 0 || text.indexOf(".", secondDot + 1) >= 0) return null;

  const header = base64UrlText(text.slice(0, firstDot));
  if (header === null) return null;
  try {
    const parsed: unknown = JSON.parse(header);
    if (typeof parsed !== "object" || parsed === null || !("alg" in parsed)) return null;
    return { text: JSON.stringify(decodeJwt(text), null, 2), steps: [STEP.jwt], format: "json" };
  } catch {
    return null;
  }
}

// --- JSON string ---

// A JSON string literal whose content is JSON: unwrap it, once per level of encoding
function peelJsonString(text: string, depth: number): Layer | null {
  if (text.charCodeAt(text.length - 1) !== 0x22) return null;
  // Cheap look at the content start: "{ or "[ (or an escaped quote for a second level)
  const next = text.charCodeAt(1);
  if (next !== 0x7b && next !== 0x5b && next !== 0x5c && next > 0x20) return null;

  const steps: DecodeStep[] = [];
  let current = text;
  for (;;) {
    let value: unknown;
    try {
      value = JSON.parse(current);
    } catch {
      break;
    }
    if (typeof value !== "string") break;
    const inner = value.trim();
    if (steps.length >= depth) break;
    if (inner.startsWith('"')) {
      steps.push(STEP.jsonString);
      current = inner;
      continue;
    }
    if (!inner.startsWith("{") && !inner.startsWith("[")) break;
    const format = detectFormat(value);
    if (!JSON_FORMATS.has(format)) break;
    steps.push(STEP.jsonString);
    return { text: value, steps, format };
  }
  return null;
}
