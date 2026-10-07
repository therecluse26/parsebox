import JSON5 from "json5";
import yaml from "js-yaml";
import TOML from "@ltd/j-toml";
import { XMLValidator } from "fast-xml-parser";
import { decode as toonDecode } from "@toon-format/toon";
import { decode as msgpackDecode } from "@msgpack/msgpack";

// Shared with the TOML reader: multi-line strings need a joiner, and plain numbers keep JSON output working
export const TOML_PARSE_OPTIONS = { joiner: "\n", bigint: false } as const;

export interface Detection {
  format: string;
  /**
   * Present when detection already parsed the text exactly as `parseText(input, format)`
   * would, so the caller can skip the second parse.
   */
  value?: unknown;
}

/**
 * Guess the format of pasted text. Returns a format `value` from `formatOptions`.
 *
 * The checks run from the strictest to the loosest. Each check needs a positive
 * sign of its format, so a loose format (CSV, YAML) cannot take input that a
 * strict format (JSON, Base64) would accept.
 */
export function detectFormat(input: string): string {
  return detectFormatWithValue(input).format;
}

/** Like `detectFormat`, and also returns the parsed value when a check parsed it. */
export function detectFormatWithValue(input: string): Detection {
  const text = input.trim();
  if (!text) return { format: "text" };

  const context = sourceContext(input, text);
  for (const [format, check] of CHECKS) {
    try {
      const match = check(text, context);
      if (match === true) return { format };
      if (match) return { format, value: match.value };
    } catch {
      // A parser threw: not this format
    }
  }
  return { format: "text" };
}

/** A check's result: false, true, or the parsed value when it equals what the reader would return */
type Match = boolean | { value: unknown };

interface SourceContext {
  input: string;
  /** Trim removed only spaces, tabs and line breaks, which the JSON and JSON5 readers ignore too */
  plainEdges: boolean;
  /** Like `plainEdges`, without a lone carriage return (TOML rejects it) */
  tomlEdges: boolean;
  /** `input` is `text` plus plain trailing whitespace: YAML can load `input` itself */
  yamlExact: boolean;
}

const CHECKS: [string, (text: string, context: SourceContext) => Match][] = [
  ["json", isJson],
  ["jsonl", isJsonl],
  ["json5", isJson5],
  ["xml", isXml],
  ["binary", isBinary],
  ["hex", isHex],
  ["msgpack", isMsgpack],
  ["base64", isBase64],
  ["querystring", isQueryString],
  ["uri", isUriEncoded],
  ["dotenv", isDotenv],
  ["toml", isToml],
  ["ini", isIni],
  ["toon", isToon],
  ["yaml", isYaml],
  ["tsv", (text) => isDelimited(text, "\t")],
  ["csv", (text) => [",", ";", "|"].some((delimiter) => isDelimited(text, delimiter))],
];

function sourceContext(input: string, text: string): SourceContext {
  // Trim only removes whitespace, so the leading and trailing parts are short scans from each end
  let start = 0;
  while (/\s/.test(input[start])) start++;
  let end = input.length;
  while (/\s/.test(input[end - 1])) end--;
  const lead = input.slice(0, start);
  const trail = input.slice(end);
  const plainEdges = /^[ \t\r\n]*$/.test(lead + trail);
  const tomlEdges = /^(?:[ \t\n]|\r\n)*$/.test(lead) && /^(?:[ \t\n]|\r\n)*$/.test(trail);
  return { input, plainEdges, tomlEdges, yamlExact: plainEdges && start === 0 };
}

const isStructured = (value: unknown) => typeof value === "object" && value !== null;

/**
 * Calls `test` with each trimmed, non-blank line that does not start with a
 * comment prefix (lines split like `text.split(/\r?\n/)`). Stops and returns
 * false at the first line that fails, so a wrong format exits after one line
 * instead of splitting the whole text.
 */
function everyLine(text: string, commentPrefixes: string[], test: (line: string) => boolean): boolean {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const lineEnd = end > start && text.charCodeAt(end - 1) === 13 && end < text.length ? end - 1 : end;
    const line = text.slice(start, lineEnd).trim();
    if (line !== "" && !commentPrefixes.some((prefix) => line.startsWith(prefix)) && !test(line)) return false;
    start = end + 1;
  }
  return true;
}

// The first trimmed, non-blank, non-comment line, or ""
function firstLine(text: string, commentPrefixes: string[]): string {
  let first = "";
  everyLine(text, commentPrefixes, (line) => {
    first = line;
    return false;
  });
  return first;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

// True when the bytes are UTF-8 text without control characters (tab and line breaks are allowed)
function isReadableText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    return !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(utf8.decode(bytes));
  } catch {
    return false;
  }
}

function isJson(text: string, context: SourceContext): Match {
  if (!/^[{["]/.test(text)) return false;
  const value = JSON.parse(text);
  return context.plainEdges ? { value } : true;
}

function isJsonl(text: string): Match {
  const values: unknown[] = [];
  const ok = everyLine(text, [], (line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return false;
    }
    values.push(value);
    return isStructured(value);
  });
  if (!ok || values.length < 2) return false;
  // The reader parses untrimmed lines: the values match unless trim removed whitespace that JSON rejects
  return /[^\S \t\r\n]/.test(text) ? true : { value: values };
}

function isJson5(text: string, context: SourceContext): Match {
  // JSON5 files often open with a comment
  const body = text.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/, "");
  if (!/^[{[]/.test(body)) return false;
  const value = JSON5.parse(text);
  return context.plainEdges ? { value } : true;
}

function isXml(text: string): boolean {
  return text.startsWith("<") && text.endsWith(">") && XMLValidator.validate(text) === true;
}

function isBinary(text: string): boolean {
  return /^[01]{8}(?:\s*[01]{8})*$/.test(text);
}

function isHex(text: string): boolean {
  // One scan with an early exit, before building the compact copy
  let digits = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHexDigit(code)) digits++;
    else if (!isSpace(code)) return false;
  }
  if (digits === 0 || digits % 2 !== 0) return false;
  // Short inputs need more proof: "2026" is a number and "cafe" is a word
  if (digits >= 16) return true;
  const compact = text.replace(/\s+/g, "");
  const bytes = Uint8Array.from(compact.match(/../g)!, (byte) => parseInt(byte, 16));
  return /[a-fA-F]/.test(compact) && isReadableText(bytes);
}

const isHexDigit = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);

// The `\s` regex class (the characters trim removes), without a regex per character
const isSpace = (code: number) =>
  code === 32 ||
  (code >= 9 && code <= 13) ||
  (code > 127 &&
    (code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 ||
      code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff));

// Returns the decoded bytes when the text is canonical Base64, otherwise null
function base64Bytes(text: string): Uint8Array | null {
  // One scan with an early exit, before building the compact copy
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!isBase64Char(code) && !isSpace(code)) return null;
  }
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 4 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const binary = atob(compact);
  if (btoa(binary) !== compact) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const isBase64Char = (code: number) =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 47 && code <= 57) || code === 43 || code === 61;

function isMsgpack(text: string): boolean {
  const bytes = base64Bytes(text);
  // A single byte decodes as a number, so only accept maps and arrays
  return bytes !== null && isStructured(msgpackDecode(bytes));
}

function isBase64(text: string): boolean {
  const bytes = base64Bytes(text);
  if (bytes === null) return false;
  if (isReadableText(bytes)) return true;
  // Long Base64 of binary data mixes cases and digits; words almost never decode to readable text
  return text.length >= 32 && /[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text);
}

function isQueryString(text: string): boolean {
  const query = text.startsWith("?") ? text.slice(1) : text;
  if (/\s/.test(query) || !query.includes("=")) return false;
  const pairs = query.split("&");
  if (!pairs.every((pair) => /^[^=&]+(?:=[^&]*)?$/.test(pair))) return false;
  // A single KEY=value pair is more likely dotenv, unless it has query-string-only syntax
  return pairs.length >= 2 || /[%+[\]]/.test(query);
}

function isUriEncoded(text: string): boolean {
  if (/\s/.test(text) || !/%[0-9A-Fa-f]{2}/.test(text)) return false;
  decodeURIComponent(text);
  return true;
}

function isDotenv(text: string): boolean {
  const keys: string[] = [];
  let openQuote: string | null = null;

  for (let start = 0; start <= text.length; ) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const rawLine = text.slice(start, end > start && text.charCodeAt(end - 1) === 13 && end < text.length ? end - 1 : end);
    start = end + 1;

    // Inside a quoted multi-line value: wait for the closing quote
    if (openQuote) {
      if (rawLine.includes(openQuote)) openQuote = null;
      continue;
    }
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)=(.*)$/.exec(line);
    if (!match) return false;
    keys.push(match[1]);

    const value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && value.indexOf(quote, 1) === -1) {
      openQuote = quote;
    }
  }
  if (openQuote || keys.length === 0) return false;

  // UPPER_CASE names are the dotenv convention
  if (keys.every((key) => key === key.toUpperCase())) return true;
  // Lowercase key=value text that is also valid TOML belongs to TOML
  try {
    TOML.parse(text, TOML_PARSE_OPTIONS);
    return false;
  } catch {
    return true;
  }
}

function isToml(text: string, context: SourceContext): Match {
  // Every TOML line is a comment, a [table] or a key = value, so the first content line rules out most other text
  const first = firstLine(text, ["#"]);
  if (!first.startsWith("[") && !/^[A-Za-z0-9_"'-][^=]*=/.test(first)) return false;
  const value = TOML.parse(text, TOML_PARSE_OPTIONS);
  // An empty or comment-only document also parses, so require a table or a key
  const hasEntry = !everyLine(
    text,
    ["#"],
    (line) => !(/^\[\[?[^\]]+\]\]?(?:\s*#.*)?$/.test(line) || /^[A-Za-z0-9_"'.-]+\s*=/.test(line))
  );
  if (!hasEntry) return false;
  return context.tomlEdges ? { value } : true;
}

function isIni(text: string): boolean {
  const isSection = (line: string) => /^\[[^[\]]+\]$/.test(line);
  let hasSection = false;
  const allEntries = everyLine(text, [";", "#"], (line) => {
    if (isSection(line)) return (hasSection = true);
    return /^[^=]+=/.test(line);
  });
  return allEntries && hasSection;
}

function isToon(text: string): boolean {
  // TOON array headers: key[3]: a,b,c  or  key[3]{id,name}:  or  [3]:
  if (!/\[#?\d+[^\]\n]*\](?:\{[^}\n]*\})?:/.test(text)) return false;
  toonDecode(text);
  return true;
}

function isYaml(text: string, context: SourceContext): Match {
  if (!mayBeYamlCollection(text)) return false;
  // Trailing line breaks are not content, so `input` loads the same as `text` and its value is reusable
  const value = yaml.load(context.yamlExact ? context.input : text);
  if (!isStructured(value)) return false;
  // One line like "Note: call me back" parses as a mapping, but it is prose
  let lines = 0;
  everyLine(text, ["#"], () => ++lines < 2);
  if (lines < 2) return false;
  return context.yamlExact ? { value } : true;
}

/**
 * False when YAML can only read the text as a plain scalar (or fail), so the
 * full YAML parse can be skipped, for example on large CSV. The root is a
 * collection only when the first content line opens with a YAML indicator or
 * is an implicit `key:` line.
 */
function mayBeYamlCollection(text: string): boolean {
  const first = firstLine(text, ["#"]);
  if (/^[-?:,[\]{}&*!|>'"%@`.]/.test(first)) return true;
  return /:(?:[ \t]|$)/.test(first);
}

/**
 * True when the text splits into at least 2 rows of the same column count
 * (2 or more), with RFC 4180 quoting. Counts fields without building them and
 * stops at the first row that does not match.
 */
function isDelimited(text: string, delimiter: string): boolean {
  const delimiterCode = delimiter.charCodeAt(0);
  let columns = -1;
  let rows = 0;
  let fields = 1;
  // The current field is empty (a quote opens a quoted field only there) and blank (whitespace only)
  let fieldEmpty = true;
  let fieldBlank = true;
  let inQuotes = false;

  // Returns false when the row ends the check
  const endRow = (): boolean => {
    // A row with one blank field is a blank line and does not count
    if (fields === 1 && fieldBlank) return true;
    if (columns === -1) {
      if (fields < 2) return false;
      columns = fields;
    } else if (fields !== columns) {
      return false;
    }
    rows++;
    return true;
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (inQuotes) {
      if (code === 34 && text.charCodeAt(i + 1) === 34) {
        fieldEmpty = fieldBlank = false;
        i++;
      } else if (code === 34) {
        inQuotes = false;
      } else {
        fieldEmpty = false;
        if (fieldBlank && !isSpace(code)) fieldBlank = false;
      }
    } else if (code === 34 && fieldEmpty) {
      inQuotes = true;
    } else if (code === delimiterCode) {
      fields++;
      fieldEmpty = true;
      fieldBlank = true;
    } else if (code === 10 || code === 13) {
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      if (!endRow()) return false;
      fields = 1;
      fieldEmpty = true;
      fieldBlank = true;
    } else {
      fieldEmpty = false;
      if (fieldBlank && !isSpace(code)) fieldBlank = false;
    }
  }
  if (inQuotes) return false;
  return endRow() && rows >= 2;
}
