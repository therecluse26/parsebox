import { jsonrepair } from "jsonrepair";
import { LIMITS } from "../config/limits.ts";
import type { ParseErrorInfo, RepairInfo } from "./convert/types.ts";

/**
 * Repair mode: fix almost-valid JSON (trailing commas, single quotes, Python
 * constants, comments, missing brackets...). The pipeline calls this only after
 * normal parsing fails, so the extra scan below costs nothing on valid input.
 *
 * jsonrepair does not say what it changed, so one string-aware pass over the
 * original text counts the kinds of fixes. The same pass decides whether repair
 * is sane at all: it declines text that uses bare words as values, such as YAML
 * flow collections (`[a, b]`, `{ foo: bar }`), INI or TOML headers
 * (`[section]`) and log prefixes (`[INFO] ...`). Quoting those would be a guess
 * that turns a valid YAML/INI/TOML document, or plain text, into surprising
 * JSON. Bare keys (`{foo: 1}`) and known constants (True, None, undefined, NaN)
 * are fine, because their JSON meaning is clear.
 */
export function tryRepair(text: string): { value: unknown; info: RepairInfo } | null {
  if (text.length > LIMITS.repairMaxChars) return null;

  // JSON copied out of a log or a string literal: {\"a\": \"b\"}
  let source = text;
  const firstQuote = text.indexOf('"');
  const escaped = firstQuote > 0 && text.charCodeAt(firstQuote - 1) === BACKSLASH;
  if (escaped) source = unescapeJson(text);

  const scan = scanFixes(source);
  if (!scan) return null;
  if (escaped) scan.counts[FIX_ESCAPED] = 1;

  // When the unescape and the scan's comma and bracket fixes were all it took, skip jsonrepair (about 1 s per 20 MB)
  let value: unknown;
  let parsed = false;
  if (scan.text !== text) {
    try {
      value = JSON.parse(scan.text);
      parsed = true;
    } catch {
      // Other fixes are needed too
    }
  }
  if (!parsed) {
    try {
      value = JSON.parse(jsonrepair(scan.text));
    } catch {
      return null;
    }
  }

  return { value, info: { format: "json", ...describeFixes(scan.counts) } };
}

// ---------------------------------------------------------------------------
// Fix scan

// Fix kinds, in the order the notice lists them
const FIX_TRAILING_COMMA = 0;
const FIX_SINGLE_QUOTE = 1;
const FIX_UNQUOTED_KEY = 2;
const FIX_COMMENT = 3;
const FIX_PYTHON = 4;
const FIX_MISSING_CLOSE = 5;
const FIX_MISSING_COMMA = 6;
const FIX_MISSING_QUOTE = 7;
const FIX_ESCAPED = 8;
const FIX_UNDEFINED = 9;
const FIX_NAN = 10;
const FIX_SPECIAL_QUOTE = 11;
const FIX_EXTRA_CLOSE = 12;
const FIX_EXTRA_COMMA = 13;
const FIX_CONTROL = 14;
const FIX_BAD_ESCAPE = 15;
const FIX_NUMBER = 16;
const FIX_MISSING_COLON = 17;
const FIX_WRAPPER = 18;
const FIX_FENCE = 19;
const FIX_CONCAT = 20;
const FIX_ELLIPSIS = 21;
const FIX_ROOTS = 22;

const FIX_LABELS = [
  "trailing commas removed",
  "single quotes → double quotes",
  "unquoted keys quoted",
  "comments removed",
  "True/False/None → true/false/null",
  "missing closing brackets added",
  "missing commas added",
  "missing quotes added",
  "escaped quotes unescaped",
  "undefined → null",
  "NaN/Infinity → strings",
  "curly quotes → double quotes",
  "extra closing brackets removed",
  "extra commas removed",
  "line breaks in strings escaped",
  "invalid escapes fixed",
  "invalid numbers fixed",
  "missing colons added",
  "function wrappers removed",
  "code fences removed",
  "strings concatenated",
  "ellipses removed",
  "values wrapped in an array",
];

function describeFixes(counts: number[]): { fixes: string[]; fixCount: number } {
  // Several root values are normal for JSONL; mention the wrap only when it is the sole change
  let fixCount = 0;
  for (let kind = 0; kind < FIX_ROOTS; kind++) fixCount += counts[kind];
  if (fixCount === 0) {
    if (counts[FIX_ROOTS] === 0) return { fixes: ["syntax fixed"], fixCount: 1 };
    return { fixes: [FIX_LABELS[FIX_ROOTS]], fixCount: 1 };
  }

  const fixes: string[] = [];
  for (let kind = 0; kind < FIX_ROOTS && fixes.length < LIMITS.repairFixesShown; kind++) {
    const count = counts[kind];
    if (count > 0) fixes.push(count > 1 ? `${FIX_LABELS[kind]} (${count.toLocaleString("en-US")})` : FIX_LABELS[kind]);
  }
  return { fixes, fixCount };
}

// Container stack entries
const OBJECT = 1;
const ARRAY = 2;
const CALL = 3;

// What the scanner expects next
const EXPECT_KEY = 0;
const EXPECT_COLON = 1;
const EXPECT_VALUE = 2;
const AFTER_VALUE = 3;

const BACKSLASH = 92;
const PYTHON_CONSTANTS = new Set(["True", "False", "None"]);
const JSON_CONSTANTS = new Set(["true", "false", "null"]);

/**
 * One pass over `text`: count each kind of fix, and apply the comma and bracket
 * fixes directly. jsonrepair makes those by searching back through its whole
 * output, once per fix, which is quadratic: 2 MB with a trailing comma per row
 * took 50 s. The fixes left for jsonrepair (quotes, constants, comments) are
 * linear there. Returns null when the text uses bare words as values (see
 * `tryRepair`).
 */
function scanFixes(text: string): { counts: number[]; text: string } | null {
  const counts = new Array<number>(FIX_LABELS.length).fill(0);
  const stack: number[] = [];
  const length = text.length;
  let expect = EXPECT_VALUE;
  let afterComma = false;
  let commaAt = -1;
  let concat = false;
  let roots = 0;
  let firstRoot = 0;
  let openQuote = 0; // the quote of a string still open at the end
  let i = 0;

  // Edits sorted by position: delete `editDelete[n]` characters at `editAt[n]`, then insert `editInsert[n]`
  const editAt: number[] = [];
  const editDelete: number[] = [];
  const editInsert: string[] = [];
  const edit = (at: number, remove: number, insert: string) => {
    editAt.push(at);
    editDelete.push(remove);
    editInsert.push(insert);
  };

  // A value starts at `at`: add a missing comma, or note another root value
  const startValue = (at: number) => {
    if (expect === AFTER_VALUE) {
      if (concat) {
        concat = false;
      } else {
        if (stack.length === 0) roots++;
        else counts[FIX_MISSING_COMMA]++;
        edit(at, 0, ",");
      }
    } else if (expect === EXPECT_COLON) {
      counts[FIX_MISSING_COLON]++;
    } else if (stack.length === 0) {
      if (roots++ === 0) firstRoot = at;
    }
    afterComma = false;
  };

  // Is the token at i an object key? (a string or a bare word)
  const atKey = () => stack[stack.length - 1] === OBJECT && (expect === EXPECT_KEY || expect === AFTER_VALUE);

  while (i < length) {
    const c = text.charCodeAt(i);

    // Whitespace, including the non-breaking and wide spaces jsonrepair accepts
    if (c === 32 || c === 10 || c === 13 || c === 9 || isWideSpace(c)) {
      i++;
      continue;
    }

    // Strings: " ' ` “ ‘
    if (c === 34 || c === 39 || c === 96 || c === 0x201c || c === 0x2018) {
      if (c === 96 && text.charCodeAt(i + 1) === 96 && text.charCodeAt(i + 2) === 96) {
        // Markdown code fence: skip the fence line
        counts[FIX_FENCE] = 1;
        const end = text.indexOf("\n", i);
        i = end < 0 ? length : end + 1;
        continue;
      }
      const isKey = atKey();
      startValue(i);
      if (c === 39) counts[FIX_SINGLE_QUOTE]++;
      else if (c !== 34) counts[FIX_SPECIAL_QUOTE]++;
      const close = c === 0x201c ? 0x201d : c === 0x2018 ? 0x2019 : c;
      i++;
      let closed = false;
      while (i < length) {
        const s = text.charCodeAt(i);
        if (s === BACKSLASH) {
          const e = text.charCodeAt(i + 1);
          // Valid escapes: " \ / b f n r t u, plus \' inside single quotes
          if (!(e === 34 || e === 92 || e === 47 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116 || e === 117 || e === close)) {
            counts[FIX_BAD_ESCAPE]++;
          }
          i += 2;
          continue;
        }
        i++;
        if (s === close || (close === 0x201d && s === 0x201c)) {
          closed = true;
          break;
        }
        if (s < 32) counts[FIX_CONTROL]++;
      }
      if (!closed) {
        counts[FIX_MISSING_QUOTE]++;
        openQuote = c;
      }
      expect = isKey ? EXPECT_COLON : AFTER_VALUE;
      continue;
    }

    if (c === 123 || c === 91) {
      // { [
      startValue(i);
      stack.push(c === 123 ? OBJECT : ARRAY);
      expect = c === 123 ? EXPECT_KEY : EXPECT_VALUE;
      i++;
      continue;
    }

    if (c === 125 || c === 93 || c === 41) {
      // } ] )
      if (afterComma) {
        counts[FIX_TRAILING_COMMA]++;
        edit(commaAt, 1, "");
        afterComma = false;
      }
      const want = c === 125 ? OBJECT : c === 93 ? ARRAY : CALL;
      const depth = stack.length;
      if (depth > 0 && stack[depth - 1] === want) {
        stack.pop();
      } else if (depth > 1 && stack[depth - 2] === want) {
        // { "a": [1 } closes the array too
        counts[FIX_MISSING_CLOSE]++;
        edit(i, 0, stack[depth - 1] === OBJECT ? "}" : stack[depth - 1] === ARRAY ? "]" : ")");
        stack.length = depth - 2;
      } else {
        counts[FIX_EXTRA_CLOSE]++;
      }
      expect = AFTER_VALUE;
      i++;
      continue;
    }

    if (c === 44) {
      // ,
      if (afterComma || expect !== AFTER_VALUE) counts[FIX_EXTRA_COMMA]++;
      afterComma = true;
      commaAt = i;
      expect = stack[stack.length - 1] === OBJECT ? EXPECT_KEY : EXPECT_VALUE;
      i++;
      continue;
    }

    if (c === 58) {
      // :
      expect = EXPECT_VALUE;
      i++;
      continue;
    }

    if (c === 47) {
      // Comments: // and /* */
      const next = text.charCodeAt(i + 1);
      if (next === 47 || next === 42) {
        counts[FIX_COMMENT]++;
        const end = next === 47 ? text.indexOf("\n", i + 2) : text.indexOf("*/", i + 2);
        i = end < 0 ? length : next === 47 ? end : end + 2;
        continue;
      }
      i++;
      continue;
    }

    if (c === 43 && expect === AFTER_VALUE) {
      // "a" + "b"
      counts[FIX_CONCAT]++;
      concat = true;
      i++;
      continue;
    }

    if ((c >= 48 && c <= 57) || c === 45 || c === 46 || c === 43) {
      // Numbers, and the "..." placeholder
      if (c === 46 && text.startsWith("...", i)) {
        counts[FIX_ELLIPSIS]++;
        afterComma = false;
        i += 3;
        continue;
      }
      let end = i + 1;
      while (end < length && isWordChar(text.charCodeAt(end))) end++;
      const isKey = atKey();
      startValue(i);
      if (c === 45 && text.startsWith("Infinity", i + 1)) {
        counts[FIX_NAN]++;
      } else if (isKey) {
        counts[FIX_UNQUOTED_KEY]++;
      } else {
        const kind = numberKind(text, i, end);
        if (kind === BAD_NUMBER) return null; // 0x1F, 2020-01-01: YAML scalars, not broken JSON
        if (kind === LOOSE_NUMBER) counts[FIX_NUMBER]++;
      }
      expect = isKey ? EXPECT_COLON : AFTER_VALUE;
      i = end;
      continue;
    }

    if (c === BACKSLASH) {
      // A stray escape outside a string
      i += 2;
      continue;
    }

    if (c === 59) {
      // ; after JSONP
      i++;
      continue;
    }

    if (isWordStart(c)) {
      let end = i + 1;
      while (end < length && isWordChar(text.charCodeAt(end))) end++;
      let next = end;
      while (next < length && (text.charCodeAt(next) === 32 || text.charCodeAt(next) === 9)) next++;
      const nc = text.charCodeAt(next);
      const isKey = atKey() && nc === 58;
      startValue(i);
      if (nc === 40) {
        // NumberLong("2"), ObjectId("..."), callback({...})
        counts[FIX_WRAPPER]++;
        stack.push(CALL);
        expect = EXPECT_VALUE;
        i = next + 1;
        continue;
      }
      if (isKey) {
        counts[FIX_UNQUOTED_KEY]++;
      } else {
        const word = text.slice(i, end);
        if (PYTHON_CONSTANTS.has(word)) counts[FIX_PYTHON]++;
        else if (word === "undefined") counts[FIX_UNDEFINED]++;
        else if (word === "NaN" || word === "Infinity") counts[FIX_NAN]++;
        else if (nc === 34) counts[FIX_MISSING_QUOTE]++; // hello" is missing its opening quote
        else if (!JSON_CONSTANTS.has(word) && !(next >= length && isTruncatedConstant(word))) return null;
      }
      expect = isKey ? EXPECT_COLON : AFTER_VALUE;
      i = end;
      continue;
    }

    // Anything else: leave it to jsonrepair, which throws on what it cannot fix
    i++;
  }

  if (roots === 0) return null;
  if (afterComma) {
    counts[FIX_TRAILING_COMMA]++;
    edit(commaAt, 1, "");
  }
  counts[FIX_MISSING_CLOSE] += stack.length;

  // Close what the text left open. A string open at the end is closed only when it
  // used double quotes and does not end in a backslash; otherwise jsonrepair decides.
  const closable = openQuote === 0 || (openQuote === 34 && text.charCodeAt(length - 1) !== BACKSLASH);
  if (closable) {
    let closers = openQuote === 0 ? "" : '"';
    for (let depth = stack.length - 1; depth >= 0; depth--) {
      closers += stack[depth] === OBJECT ? "}" : stack[depth] === ARRAY ? "]" : ")";
    }
    if (roots > 1) closers += "]";
    if (closers) edit(length, 0, closers);
  }
  if (roots > 1) counts[FIX_ROOTS] = 1;

  // Apply the edits; several root values (JSONL) become one array
  const wrap = roots > 1 && closable;
  if (editAt.length === 0 && !wrap) return { counts, text };
  const parts: string[] = [];
  let last = 0;
  if (wrap) {
    parts.push(text.slice(0, firstRoot), "[");
    last = firstRoot;
  }
  for (let n = 0; n < editAt.length; n++) {
    parts.push(text.slice(last, editAt[n]), editInsert[n]);
    last = editAt[n] + editDelete[n];
  }
  parts.push(text.slice(last));
  return { counts, text: parts.join("") };
}

// A cut-off constant at the end of truncated input, such as `tr` or `nul`
function isTruncatedConstant(word: string): boolean {
  return "true".startsWith(word) || "false".startsWith(word) || "null".startsWith(word);
}

function isWordStart(c: number): boolean {
  if (c < 0x80) return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
  return !isWideSpace(c) && c !== 0x201c && c !== 0x201d && c !== 0x2018 && c !== 0x2019;
}

// The non-breaking and wide spaces that jsonrepair treats as whitespace
function isWideSpace(c: number): boolean {
  return c === 0xa0 || c === 0xfeff || c === 0x3000 || c === 0x202f || c === 0x205f || (c >= 0x2000 && c <= 0x200a);
}

function isWordChar(c: number): boolean {
  return isWordStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46;
}

const GOOD_NUMBER = 0;
const LOOSE_NUMBER = 1;
const BAD_NUMBER = 2;

/** JSON number, a loose one jsonrepair fixes (.5, 1., +1, 01, 1e), or not a number */
function numberKind(text: string, start: number, end: number): number {
  let i = start;
  let loose = false;
  let c = text.charCodeAt(i);
  if (c === 45 || c === 43) {
    if (c === 43) loose = true;
    c = text.charCodeAt(++i);
  }
  const intStart = i;
  while (i < end && isDigit(text.charCodeAt(i))) i++;
  if (i === intStart) loose = true;
  else if (text.charCodeAt(intStart) === 48 && i - intStart > 1) loose = true;
  if (i < end && text.charCodeAt(i) === 46) {
    const fracStart = ++i;
    while (i < end && isDigit(text.charCodeAt(i))) i++;
    if (i === fracStart) loose = true;
  }
  if (i < end && (text.charCodeAt(i) === 101 || text.charCodeAt(i) === 69)) {
    i++;
    if (i < end && (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45)) i++;
    const expStart = i;
    while (i < end && isDigit(text.charCodeAt(i))) i++;
    if (i === expStart) loose = true;
  }
  if (i !== end || (end - start === 1 && !isDigit(text.charCodeAt(start)))) return BAD_NUMBER;
  return loose ? LOOSE_NUMBER : GOOD_NUMBER;
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

const ESCAPES: Record<string, string> = { "\\": "\\", '"': '"', "/": "/", n: "\n", r: "\r", t: "\t" };

// {\"a\":\n \"b\"} → {"a":\n "b"}. One linear pass; the pattern cannot backtrack.
function unescapeJson(text: string): string {
  return text.replace(/\\(["\\/nrt])/g, (_, ch: string) => ESCAPES[ch]);
}

// ---------------------------------------------------------------------------
// Error help

/**
 * Error help: turn a parser error into a message with a 1-based line and column
 * and, when cheap, a short hint. Does not parse the text again, except for
 * JSONL, where it re-parses lines only up to the first bad one (no more work
 * than the failed parse did) to find which line failed.
 */
export function describeParseError(error: unknown, text: string, format: string): ParseErrorInfo {
  const raw = errorMessage(error);
  const info = locate(error, raw, text, format);
  if (info.message.length > MAX_MESSAGE) info.message = info.message.slice(0, MAX_MESSAGE - 1) + "…";
  if (!info.message) info.message = `invalid ${format}`;
  return info;
}

const MAX_MESSAGE = 200;

interface Located extends ParseErrorInfo {
  message: string;
}

function locate(error: unknown, raw: string, text: string, format: string): Located {
  const err = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;

  if (format === "jsonl") return locateJsonl(raw, text);
  if (format === "json" || format === "json5" || isJsonMessage(raw)) {
    const json = locateJson(err, raw, text);
    if (json) return json;
  }

  // js-yaml: a YAMLException with a 0-based mark; `message` repeats the snippet
  const mark = err.mark as { line?: unknown; column?: unknown } | undefined;
  if (mark && typeof mark.line === "number" && typeof mark.column === "number") {
    const reason = typeof err.reason === "string" && err.reason ? err.reason : raw.split("\n", 1)[0];
    return { message: tidy(reason), line: mark.line + 1, column: mark.column + 1, hint: yamlHint(reason) };
  }

  // fast-xml-parser's XMLValidator: { err: { code, msg, line, col } }
  const xml = (err.err ?? err) as Record<string, unknown>;
  if (typeof xml.msg === "string" && typeof xml.line === "number") {
    return {
      message: tidy(xml.msg),
      line: xml.line,
      column: typeof xml.col === "number" ? xml.col : undefined,
      hint: xmlHint(String(xml.code ?? ""), xml.msg),
    };
  }

  // papaparse: { type, code, message, row, index }, or the errors array. Only `index` is a text
  // position; `row` counts records, which differ from lines when a quoted field spans lines.
  const papa = papaError(error);
  if (papa) {
    const message = tidy(String(papa.message ?? papa.code));
    if (typeof papa.index !== "number") return { message, hint: csvHint(String(papa.code)) };
    const { line, column } = lineColumnAt(text, Math.min(papa.index, text.length));
    return { message, line, column, hint: csvHint(String(papa.code)) };
  }

  if (typeof err.line === "number") {
    const column = typeof err.column === "number" ? err.column : typeof err.col === "number" ? err.col : undefined;
    return { message: tidy(raw), line: err.line, column };
  }

  // @ltd/j-toml: "... at line N: <source line>"
  const at = raw.indexOf(" at line ");
  if (at >= 0) {
    const line = leadingInt(raw, at + 9);
    if (line > 0) {
      const message = raw.slice(0, at).replace(/,? which is found$/, "");
      return { message: tidy(message), line, hint: tomlHint(raw) };
    }
  }

  // @toon-format/toon: "Line N: ..."
  if (raw.startsWith("Line ")) {
    const line = leadingInt(raw, 5);
    const colon = raw.indexOf(": ");
    if (line > 0 && colon > 0) {
      const message = raw.slice(colon + 2);
      return { message: tidy(message), line, hint: toonHint(message) };
    }
  }

  if (format === "xml" && error instanceof TypeError) return { message: "malformed xml", hint: "check for unclosed tags or quotes" };
  return { message: tidy(raw), hint: format === "toon" ? toonHint(raw) : undefined };
}

function papaError(error: unknown): Record<string, unknown> | null {
  const list = Array.isArray(error) ? error : [error];
  let first: Record<string, unknown> | null = null;
  for (const item of list) {
    if (typeof item !== "object" || item === null || typeof (item as Record<string, unknown>).code !== "string") continue;
    const e = item as Record<string, unknown>;
    if (e.code === "UndetectableDelimiter") continue;
    if (typeof e.index === "number") return e;
    first ??= e;
  }
  return first;
}

function errorMessage(error: unknown): string {
  if (Array.isArray(error)) return error.length ? errorMessage(error[0]) : "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (e.err && typeof (e.err as Record<string, unknown>).msg === "string") return (e.err as Record<string, string>).msg;
  }
  return String(error);
}

function isJsonMessage(message: string): boolean {
  return message.includes("JSON") || message.startsWith("JSON5:");
}

/** JSON.parse (V8, Firefox, Safari) and JSON5 errors */
function locateJson(err: Record<string, unknown>, raw: string, text: string): Located | null {
  let position = -1;
  let line: number | undefined;
  let column: number | undefined;

  if (typeof err.lineNumber === "number" && typeof err.columnNumber === "number" && raw.startsWith("JSON5:")) {
    // JSON5: 1-based lineNumber/columnNumber
    line = err.lineNumber;
    column = err.columnNumber;
    position = positionAt(text, line, column);
  } else {
    // V8: "... at position N" and, in newer versions, " (line L column C)"
    const p = raw.lastIndexOf(" at position ");
    if (p >= 0) {
      position = leadingInt(raw, p + 13);
      if (position >= 0) ({ line, column } = lineColumnAt(text, position));
    } else {
      // Firefox: "... at line L column C of the JSON data"
      const f = raw.lastIndexOf(" at line ");
      if (f >= 0 && raw.includes(" column ", f)) {
        line = leadingInt(raw, f + 9);
        column = leadingInt(raw, raw.indexOf(" column ", f) + 8);
        if (line > 0 && column > 0) position = positionAt(text, line, column);
        else line = column = undefined;
      }
    }
  }

  if (position < 0 && raw.startsWith("Unexpected token '")) {
    // V8 without a position: Unexpected token 'T', ..."a": 1, "b": True, "c"... is not valid JSON
    position = snippetPosition(raw, text);
    if (position >= 0) ({ line, column } = lineColumnAt(text, position));
  }

  if (/^(?:Unexpected end of JSON input|JSON\.parse: unexpected end of data|JSON Parse error: Unexpected EOF)/.test(raw) || raw.includes("invalid end of input")) {
    // The error sits just past the end of the text
    position = text.length;
    ({ line, column } = lineColumnAt(text, text.length));
  }

  const message = tidy(cleanJsonMessage(raw));
  return { message, line, column, hint: jsonHint(raw, text, position) };
}

// V8 quotes up to this many characters on each side of the bad token
const V8_CONTEXT = 10;
const V8_SUFFIX = " is not valid JSON";

/**
 * Find the bad token from V8's quoted snippet. The snippet is the whole text
 * when it is short, or the 10 characters before the token and the token plus 9
 * after it, with "..." where it was cut. Returns -1 when it cannot be placed.
 */
function snippetPosition(raw: string, text: string): number {
  const token = raw[18];
  if (!raw.endsWith(V8_SUFFIX) || raw.slice(19, 22) !== "', ") return -1;
  let snippet = raw.slice(22, raw.length - V8_SUFFIX.length);
  const cutBefore = snippet.startsWith("...");
  if (cutBefore) snippet = snippet.slice(3);
  const cutAfter = snippet.endsWith("...");
  if (cutAfter) snippet = snippet.slice(0, -3);
  if (snippet.length < 2 || snippet[0] !== '"' || snippet[snippet.length - 1] !== '"') return -1;
  snippet = snippet.slice(1, -1);

  let offset: number;
  if (cutBefore) offset = V8_CONTEXT;
  else if (cutAfter) offset = snippet.length - V8_CONTEXT;
  else offset = badTokenIn(snippet, token);
  if (offset < 0) return -1;

  // The first match: JSON.parse stopped at the first error. The search costs no more than the failed parse.
  const at = cutBefore && !cutAfter ? text.lastIndexOf(snippet) : text.indexOf(snippet);
  const position = at + offset;
  return at >= 0 && text[position] === token ? position : -1;
}

/**
 * Which `token` in a short text (under 21 characters) JSON.parse rejected: the
 * first one whose prefix fails on that token. At most 20 tiny parses.
 */
function badTokenIn(text: string, token: string): number {
  const expected = `Unexpected token '${token}'`;
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) {
    try {
      JSON.parse(text.slice(0, i + 1));
    } catch (error) {
      if (errorMessage(error).startsWith(expected)) return i;
    }
  }
  return -1;
}

function cleanJsonMessage(raw: string): string {
  let message = raw;
  if (message.startsWith("JSON.parse: ")) message = message.slice(12);
  else if (message.startsWith("JSON Parse error: ")) message = message.slice(18);
  else if (message.startsWith("JSON5: ")) message = message.slice(7);
  // Positions are reported separately
  let cut = message.lastIndexOf(" in JSON at position ");
  if (cut < 0) cut = message.lastIndexOf(" at position ");
  if (cut < 0) cut = message.lastIndexOf(" at line ");
  if (cut < 0) {
    const m = / at \d+:\d+$/.exec(message);
    if (m) cut = m.index;
  }
  if (cut >= 0) message = message.slice(0, cut);
  // V8 quotes a snippet: Unexpected token 'x', ..."a": x}" is not valid JSON
  if (message.startsWith("Unexpected token '") && message.endsWith(V8_SUFFIX)) message = message.slice(0, 20);
  return message;
}

/** A hint from the characters at and before the error position */
function jsonHint(raw: string, text: string, position: number): string | undefined {
  const lower = raw.toLowerCase();
  if (lower.includes("control character")) return "escape line breaks and tabs in strings (\\n, \\t)";
  if (lower.includes("escape")) return "fix the backslash escape (use \\\\ for a backslash)";
  if (lower.includes("unterminated string")) return "missing closing quote";
  if (lower.includes("single quote")) return "use double quotes";

  if (position < 0) {
    // Safari gives no position: hint from the message alone
    if (lower.includes("eof") || lower.includes("end of")) return "missing closing } or ]";
    if (lower.includes("property name must be a string")) return "quote the key with double quotes";
    if (raw.startsWith("Unexpected token '")) return tokenHint(raw[18]);
    return undefined;
  }

  if (position >= text.length) return lower.includes("string") ? "missing closing quote" : "missing closing } or ]";

  const ch = text[position];
  const prev = previousSignificant(text, position);

  if (ch === "'") return "use double quotes";
  if (ch === "/" && (text[position + 1] === "/" || text[position + 1] === "*")) return "remove the comment (json has no comments)";
  if (ch === "#") return "remove the comment (json has no comments)";
  if ((ch === "}" || ch === "]") && prev === ",") return "remove the trailing comma";
  if (ch === "," && (prev === "," || prev === "[" || prev === "{")) return "remove the extra comma";
  if (ch === "“" || ch === "”" || ch === "`") return "use straight double quotes";

  if (isWordStart(ch.charCodeAt(0))) {
    const word = wordAt(text, position);
    if (word === "True" || word === "False" || word === "None") return "use true, false or null";
    if (word === "undefined") return "use null";
    if (word === "NaN" || word === "Infinity") return "json has no NaN or Infinity; use null or a string";
    if (prev === "{" || prev === ",") return "quote the key with double quotes";
    return "quote the string with double quotes";
  }

  if (lower.includes("after json")) {
    if (ch === "{" || ch === "[") return "more than one value: wrap them in [ ] or use jsonl";
    if (ch === "}" || ch === "]") return "remove the extra closing bracket";
    return "remove the text after the value";
  }
  if (lower.includes("expected ':'") || lower.includes("expected colon")) return "add a colon after the key";
  if (lower.includes("expected ','") || lower.includes("expected ',' or")) {
    if (ch === "}" || ch === "]") return `mismatched bracket: expected ${lower.includes("']'") ? "]" : "}"}`;
    return "add the missing comma";
  }
  if (lower.includes("number") || lower.includes("exponent") || lower.includes("minus")) return "fix the number";
  return undefined;
}

/** A hint from the bad character alone */
function tokenHint(ch: string): string | undefined {
  if (ch === "'") return "use double quotes";
  if (ch === "/" || ch === "#") return "remove the comment (json has no comments)";
  if (ch === ",") return "remove the extra comma";
  if (ch === "T" || ch === "F" || ch === "N") return "use true, false or null";
  if (ch === "u") return "use null";
  if (isWordStart(ch.charCodeAt(0))) return "quote strings with double quotes";
  return undefined;
}

/** The nearest non-whitespace character before `position`, looking back at most 1,000 characters */
function previousSignificant(text: string, position: number): string {
  const stop = Math.max(0, position - 1000);
  for (let i = position - 1; i >= stop; i--) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 10 && c !== 13 && c !== 9) return text[i];
  }
  return "";
}

function wordAt(text: string, position: number): string {
  let end = position;
  const stop = Math.min(text.length, position + 32);
  while (end < stop && isWordStart(text.charCodeAt(end))) end++;
  return text.slice(position, end);
}

/** JSONL: find the first line that fails, parsing lines only up to it */
function locateJsonl(raw: string, text: string): Located {
  let start = 0;
  let line = 1;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const row = text.slice(start, end);
    if (row.trim()) {
      try {
        JSON.parse(row);
      } catch (error) {
        const info = locateJson({}, errorMessage(error), row) ?? { message: tidy(raw) };
        if (info.line === undefined) return { message: info.message, line, hint: info.hint };
        return { message: info.message, line: line + info.line - 1, column: info.column, hint: info.hint };
      }
    }
    start = end + 1;
    line++;
  }
  return { message: tidy(cleanJsonMessage(raw)) };
}

function yamlHint(reason: string): string | undefined {
  if (reason.includes("tab characters")) return "indent with spaces, not tabs";
  if (reason.includes("indentation")) return "check the indentation";
  if (reason.includes("duplicated mapping key")) return "remove the duplicate key";
  if (reason.includes("flow collection")) return "missing closing ] or }";
  if (reason.includes("quoted scalar")) return "missing closing quote";
  if (reason.includes("document separator")) return "check the indentation";
  if (reason.includes("incomplete explicit mapping pair") || reason.includes("multiline key")) return "quote values that contain ': '";
  return undefined;
}

function tomlHint(message: string): string | undefined {
  if (message.startsWith("Duplicate")) return "remove the duplicate key";
  if (message.includes("not closed")) return "close the bracket";
  if (message.includes("string")) return "check the string quotes";
  if (message.includes("Value can not be missing")) return "add a value after =";
  return undefined;
}

function toonHint(message: string): string | undefined {
  if (message.includes("Indentation")) return "check the indentation";
  if (message.startsWith("Expected ") && message.includes("but got")) return "the [n] count does not match the items";
  if (message.includes("Unterminated string")) return "missing closing quote";
  return undefined;
}

function xmlHint(code: string, message: string): string | undefined {
  if (code === "InvalidTag" && message.includes("Unclosed")) return "close the tag";
  if (code === "InvalidTag" && message.includes("Expected closing tag")) return "closing tags must match their opening tags";
  if (code === "InvalidAttr") return "check the attribute quotes";
  return undefined;
}

function csvHint(code: string): string | undefined {
  if (code === "MissingQuotes") return "missing closing quote";
  if (code === "TooManyFields" || code === "TooFewFields") return "this row has a different number of fields";
  return undefined;
}

/** Strip noise and keep the message to one terse line */
function tidy(message: string): string {
  let text = message;
  const newline = text.indexOf("\n");
  if (newline >= 0) text = text.slice(0, newline);
  text = text.trim();
  // Lowercase the first word to match the ui, but not acronyms like JSON
  if (text.length > 1 && text[0] >= "A" && text[0] <= "Z" && text[1] >= "a" && text[1] <= "z") {
    text = text[0].toLowerCase() + text.slice(1);
  }
  return text;
}

/** Parse the decimal digits at `start`; -1 when there are none */
function leadingInt(text: string, start: number): number {
  let value = -1;
  for (let i = start; i < text.length && i < start + 12; i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) break;
    value = (value < 0 ? 0 : value * 10) + (c - 48);
  }
  return value;
}

/** 1-based line and column of a 0-based position, with one scan up to it */
function lineColumnAt(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    if (newline < 0 || newline >= position) break;
    line++;
    lineStart = newline + 1;
  }
  return { line, column: position - lineStart + 1 };
}

/** 0-based position of a 1-based line and column, with one scan up to the line */
function positionAt(text: string, line: number, column: number): number {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const newline = text.indexOf("\n", start);
    if (newline < 0) return text.length;
    start = newline + 1;
  }
  return Math.min(start + column - 1, text.length);
}
