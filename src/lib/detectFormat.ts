import JSON5 from "json5";
import yaml from "js-yaml";
import TOML from "@ltd/j-toml";
import { XMLValidator } from "fast-xml-parser";
import { decode as toonDecode } from "@toon-format/toon";
import { decode as msgpackDecode } from "@msgpack/msgpack";

// Shared with the TOML reader: multi-line strings need a joiner, and plain numbers keep JSON output working
export const TOML_PARSE_OPTIONS = { joiner: "\n", bigint: false } as const;

/**
 * Guess the format of pasted text. Returns a format `value` from `formatOptions`.
 *
 * The checks run from the strictest to the loosest. Each check needs a positive
 * sign of its format, so a loose format (CSV, YAML) cannot take input that a
 * strict format (JSON, Base64) would accept.
 */
export function detectFormat(input: string): string {
  const text = input.trim();
  if (!text) return "text";

  for (const [format, check] of CHECKS) {
    try {
      if (check(text)) return format;
    } catch {
      // A parser threw: not this format
    }
  }
  return "text";
}

const CHECKS: [string, (text: string) => boolean][] = [
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

const isStructured = (value: unknown) => typeof value === "object" && value !== null;

const meaningfulLines = (text: string, commentPrefixes: string[] = []) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !commentPrefixes.some((prefix) => line.startsWith(prefix)));

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

function isJson(text: string): boolean {
  if (!/^[{["]/.test(text)) return false;
  JSON.parse(text);
  return true;
}

function isJsonl(text: string): boolean {
  const lines = meaningfulLines(text);
  return lines.length >= 2 && lines.every((line) => isStructured(JSON.parse(line)));
}

function isJson5(text: string): boolean {
  // JSON5 files often open with a comment
  const body = text.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/, "");
  if (!/^[{[]/.test(body)) return false;
  JSON5.parse(text);
  return true;
}

function isXml(text: string): boolean {
  return text.startsWith("<") && text.endsWith(">") && XMLValidator.validate(text) === true;
}

function isBinary(text: string): boolean {
  return /^[01]{8}(?:\s*[01]{8})*$/.test(text);
}

function isHex(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(compact)) return false;
  // Short inputs need more proof: "2026" is a number and "cafe" is a word
  if (compact.length >= 16) return true;
  const bytes = Uint8Array.from(compact.match(/../g)!, (byte) => parseInt(byte, 16));
  return /[a-fA-F]/.test(compact) && isReadableText(bytes);
}

// Returns the decoded bytes when the text is canonical Base64, otherwise null
function base64Bytes(text: string): Uint8Array | null {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 4 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const binary = atob(compact);
  if (btoa(binary) !== compact) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

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

  for (const rawLine of text.split(/\r?\n/)) {
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

function isToml(text: string): boolean {
  TOML.parse(text, TOML_PARSE_OPTIONS);
  // An empty or comment-only document also parses, so require a table or a key
  return meaningfulLines(text, ["#"]).some(
    (line) => /^\[\[?[^\]]+\]\]?(?:\s*#.*)?$/.test(line) || /^[A-Za-z0-9_"'.-]+\s*=/.test(line)
  );
}

function isIni(text: string): boolean {
  const lines = meaningfulLines(text, [";", "#"]);
  const isSection = (line: string) => /^\[[^[\]]+\]$/.test(line);
  return lines.some(isSection) && lines.every((line) => isSection(line) || /^[^=]+=/.test(line));
}

function isToon(text: string): boolean {
  // TOON array headers: key[3]: a,b,c  or  key[3]{id,name}:  or  [3]:
  if (!/\[#?\d+[^\]\n]*\](?:\{[^}\n]*\})?:/.test(text)) return false;
  toonDecode(text);
  return true;
}

function isYaml(text: string): boolean {
  const value = yaml.load(text);
  if (!isStructured(value)) return false;
  // One line like "Note: call me back" parses as a mapping, but it is prose
  return meaningfulLines(text, ["#"]).length >= 2;
}

// Splits delimited text into rows of fields, with RFC 4180 quoting. Returns null for an unclosed quote.
function delimitedRows(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) return null;
  row.push(field);
  rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function isDelimited(text: string, delimiter: string): boolean {
  const rows = delimitedRows(text, delimiter);
  if (!rows || rows.length < 2) return false;
  const columns = rows[0].length;
  return columns >= 2 && rows.every((row) => row.length === columns);
}
