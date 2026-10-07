import type { LossItem, LossReport } from "./convert/types.ts";
import { LIMITS } from "../config/limits.ts";

/**
 * Conversion loss report: list what the output format cannot keep from the
 * parsed value (nesting, types, nulls, comments...).
 *
 * `rules` are fixed facts about the format pair and cost nothing. `items` come
 * from one iterative walk of the value, which runs only when the writer for
 * `outputFormat` can lose something that the reader for `inputFormat` can
 * produce. Every kind below matches what the real writers do (see
 * tests/losses.test.ts, which writes with the real writer, reads back with the
 * real reader and checks each reported path).
 */
export function collectLosses(value: unknown, inputFormat: string, outputFormat: string): LossReport | null {
  const c: Collector = { path: [], items: new Map(), sawTyped: false, sawDate: false, rules: [] };
  inputRules(c.rules, inputFormat, outputFormat);

  switch (outputFormat) {
    case "csv":
    case "tsv":
      csvLosses(c, value);
      typedRules(c, "numbers and booleans become text");
      break;
    case "dotenv":
      dotenvLosses(c, value);
      typedRules(c, "numbers and booleans become text");
      break;
    case "querystring":
      queryLosses(c, value);
      typedRules(c, "numbers and booleans become text");
      break;
    case "ini":
      iniLosses(c, value);
      typedRules(c, "numbers become text");
      break;
    case "xml":
      xmlLosses(c, value);
      break;
    case "hex":
    case "binary":
      // The writer turns each UTF-16 unit into hex or bits; above U+00FF the reader splits them wrongly
      exoticLosses(c, value, { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers, latin1: true });
      break;
    default: {
      const kinds = EXOTIC_OUTPUTS[outputFormat];
      const can = EXOTIC_INPUTS[inputFormat];
      // No walk unless the reader can produce a value this writer changes
      if (kinds && can && ((kinds.date && can.date) || (kinds.nan && can.nan) || (kinds.binary && can.binary))) {
        exoticLosses(c, value, kinds);
      }
    }
  }

  if (c.rules.length === 0 && c.items.size === 0) return null;
  const items = [...c.items.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return { rules: c.rules, items };
}

/** Item kinds. Each reads after a count: "12 nested objects written as [object Object]". */
const K = {
  rootDropped: "root value dropped",
  rootSplit: "root text split into characters",
  rootArrayObject: "root array became an object",
  rootArrayText: "root array written as plain text",
  rootKeys: "root attributes or text dropped",
  objectString: "nested objects written as [object Object]",
  jsonText: "nested values in arrays written as JSON text",
  arrayJoined: "arrays joined into text",
  nestedArray: "nested arrays became objects",
  singleArray: "single-item arrays became plain values",
  textOnly: 'objects with only "#text" became plain text',
  columnDropped: "values dropped (key not in first row)",
  rowDropped: "non-object rows dropped",
  keyMangled: "keys mangled",
  emptyArray: "empty arrays dropped",
  emptyObject: "empty objects dropped",
  emptyObjectText: "empty objects became empty text",
  nullEmpty: "nulls became empty text",
  nullText: 'nulls became the text "null"',
  cut: "values cut at # or line break",
  stripped: "values lost outer spaces or quotes",
  trimmed: "strings trimmed",
  carriageReturn: "carriage returns became line feeds",
  backslash: "backslashes changed",
  retypedXml: "strings read back as numbers or booleans",
  retypedIni: 'strings "true"/"false"/"null" read back as values',
  numberText: "numbers read back as text",
  attrDropped: "attributes set to true or null dropped",
  attrText: "attribute values became text",
  nanNull: "NaN/Infinity became null",
  dateDropped: "dates dropped",
  dateMangled: "dates mangled",
  dateString: "dates became strings",
  binaryDropped: "binary data dropped",
  binaryNumbers: "binary data became numbers",
  latin1: "strings with characters above U+00FF garbled",
  queryArray: "arrays over 20 items read back as objects",
  queryDepth: "values nested over 6 levels read back flat",
  queryLimit: "pairs after the first 1,000 dropped on read",
} as const;

/** Most severe first: whole values lost, then structure changed, then types changed */
const ORDER: string[] = [
  K.rootDropped, K.rootSplit, K.rootArrayText, K.rootArrayObject, K.rootKeys,
  K.columnDropped, K.rowDropped, K.objectString, K.dateDropped, K.binaryDropped,
  K.keyMangled, K.cut, K.queryLimit, K.queryDepth, K.attrDropped,
  K.emptyArray, K.emptyObject, K.emptyObjectText, K.jsonText, K.arrayJoined,
  K.nestedArray, K.queryArray, K.singleArray, K.textOnly, K.dateMangled, K.latin1,
  K.stripped, K.trimmed, K.carriageReturn, K.backslash, K.nullEmpty, K.nullText, K.nanNull,
  K.binaryNumbers, K.retypedXml, K.retypedIni, K.numberText, K.attrText, K.dateString,
];

type Seg = string | number;

interface Collector {
  /** Path of the node being visited; the walk keeps it current */
  path: Seg[];
  items: Map<string, LossItem>;
  /** A number or boolean was written as text */
  sawTyped: boolean;
  /** A date was written as ISO text */
  sawDate: boolean;
  rules: string[];
}

function add(c: Collector, kind: string, extra?: Seg): void {
  let item = c.items.get(kind);
  if (!item) {
    item = { kind, count: 0, examples: [] };
    c.items.set(kind, item);
  }
  item.count++;
  if (item.examples.length < LIMITS.lossExamples) item.examples.push(formatPath(c.path, extra));
}

/** For whole-document losses, which have no useful path */
function addRoot(c: Collector, kind: string): void {
  c.items.set(kind, { kind, count: 1, examples: [] });
}

const IDENTIFIER = /^[A-Za-z_$][\w$-]*$/;

/** `db.hosts[2]`, `[3].token`, `a["key with spaces"]`; "" for the root */
function formatPath(path: readonly Seg[], extra?: Seg): string {
  let out = "";
  const n = path.length + (extra === undefined ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const seg = i < path.length ? path[i] : (extra as Seg);
    if (typeof seg === "number") out += `[${seg}]`;
    else if (IDENTIFIER.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

// --- Rules -------------------------------------------------------------------

const COMMENT_INPUTS: Record<string, true> = { yaml: true, toml: true, ini: true, json5: true, dotenv: true, xml: true };

function inputRules(rules: string[], input: string, output: string): void {
  if (COMMENT_INPUTS[input]) rules.push("comments not kept");
  // js-yaml's dump writes shared values as new anchors, so only other formats expand them
  if (input === "yaml" && output !== "yaml") rules.push("anchors, aliases and merge keys expanded");
  if (input === "xml") {
    rules.push("repeated tags regrouped, mixed text merged");
    rules.push("text trimmed, number-like text read as numbers (007 → 7)");
  }
}

function typedRules(c: Collector, rule: string): void {
  if (c.sawTyped) c.rules.push(rule);
  if (c.sawDate) c.rules.push("dates become text");
}

// --- Shared helpers ----------------------------------------------------------

function isDate(v: unknown): v is Date {
  // j-toml's OffsetDateTime, LocalDateTime, LocalDate and LocalTime extend Date too
  return v instanceof Date;
}

function isBinary(v: unknown): v is ArrayBufferView {
  return ArrayBuffer.isView(v);
}

/** An array or object the walk descends into (not a date or a byte array) */
function isContainer(v: unknown): v is object {
  return v !== null && typeof v === "object" && !isDate(v) && !isBinary(v);
}

function isEmpty(v: object): boolean {
  if (Array.isArray(v)) return v.length === 0;
  for (const _ in v) return false;
  return true;
}

type Visitor = (value: unknown, key: Seg, depth: number, parent: unknown) => boolean;

/**
 * Iterative pre-order walk in document order: a frame stack instead of
 * recursion, so deep data cannot overflow the call stack. `visit` returns true
 * to descend into the value. `c.path` holds the path of the visited value.
 */
function walk(c: Collector, root: unknown, visit: Visitor): void {
  const path = c.path;
  path.length = 0;
  if (!visit(root, "", 0, undefined) || !isContainer(root)) return;

  const containers: object[] = [root];
  const keyLists: (string[] | null)[] = [Array.isArray(root) ? null : Object.keys(root)];
  const indices: number[] = [0];
  let top = 0;

  while (top >= 0) {
    const container = containers[top];
    const keys = keyLists[top];
    const i = indices[top];
    if (i >= (keys ? keys.length : (container as unknown[]).length)) {
      top--;
      continue;
    }
    indices[top] = i + 1;
    const key: Seg = keys ? keys[i] : i;
    const value = keys ? (container as Record<string, unknown>)[key] : (container as unknown[])[i];
    path.length = top;
    path.push(key);
    if (visit(value, key, top + 1, container) && isContainer(value)) {
      top++;
      containers[top] = value;
      keyLists[top] = Array.isArray(value) ? null : Object.keys(value);
      indices[top] = 0;
    }
  }
  path.length = 0;
}

// --- JSON-like writers (json, jsonl, json5, toon, toml, text and encodings) ---

interface ExoticKinds {
  date?: string;
  nan?: string;
  binary?: string;
  latin1?: boolean;
}

/** Readers that can produce dates, NaN/Infinity or byte arrays */
const EXOTIC_INPUTS: Record<string, { date?: true; nan?: true; binary?: true }> = {
  yaml: { date: true, nan: true, binary: true },
  toml: { date: true, nan: true },
  json5: { nan: true },
  msgpack: { date: true, nan: true, binary: true },
};

/** What each JSON-like writer does with those values. yaml and msgpack keep all of them. */
const EXOTIC_OUTPUTS: Record<string, ExoticKinds> = {
  json: { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers },
  jsonl: { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers },
  text: { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers },
  base64: { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers },
  uri: { date: K.dateString, nan: K.nanNull, binary: K.binaryNumbers },
  json5: { date: K.dateString, binary: K.binaryNumbers },
  toon: { date: K.dateString, nan: K.nanNull, binary: K.binaryDropped },
  toml: { binary: K.binaryNumbers },
};

const ABOVE_LATIN1 = /[^\u0000-ÿ]/;

function exoticLosses(c: Collector, value: unknown, kinds: ExoticKinds): void {
  const { date, nan, binary, latin1 } = kinds;
  walk(c, value, (v, key) => {
    if (latin1 && typeof key === "string" && ABOVE_LATIN1.test(key)) {
      add(c, K.latin1);
      // Count the entry once even when its value is garbled too
      return isContainer(v);
    }
    if (typeof v === "string") {
      if (latin1 && ABOVE_LATIN1.test(v)) add(c, K.latin1);
      return false;
    }
    if (typeof v === "number") {
      if (nan && !Number.isFinite(v)) add(c, nan);
      return false;
    }
    if (v === null || typeof v !== "object") return false;
    if (isDate(v)) {
      if (date) add(c, date);
      return false;
    }
    if (isBinary(v)) {
      if (binary) add(c, binary);
      return false;
    }
    return true;
  });
}

// --- CSV / TSV (Papa.unparse) ----------------------------------------------------

/**
 * Papa.unparse takes its columns from the keys of the first row and writes
 * each cell with `toString()`. A first row that is an array means no header.
 */
function csvLosses(c: Collector, value: unknown): void {
  const isRows = Array.isArray(value);
  const rows: unknown[] = isRows ? value : [value];
  if (rows.length === 0) return;
  const first = rows[0];
  // Papa throws on these, so the conversion failed and nothing reaches here
  if (first === null || typeof first !== "object") return;
  const header = Array.isArray(first) ? null : new Set(Object.keys(first));
  const path = c.path;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    path.length = 0;
    if (isRows) path.push(r);
    if (row === null || typeof row !== "object" || isDate(row)) {
      add(c, K.rowDropped);
      continue;
    }
    if (header) {
      const indexed = Array.isArray(row) || isBinary(row);
      for (const key of Object.keys(row)) {
        const seg = indexed ? Number(key) : key;
        if (header.has(key)) csvCell(c, (row as Record<string, unknown>)[key], seg);
        else add(c, K.columnDropped, seg);
      }
    } else if (Array.isArray(row) || isBinary(row)) {
      const cells = row as ArrayLike<unknown>;
      for (let i = 0; i < cells.length; i++) csvCell(c, cells[i], i);
    } else {
      // Without a header, an object row has no columns to fill
      for (const key of Object.keys(row)) add(c, K.columnDropped, key);
    }
  }
  path.length = 0;
}

function csvCell(c: Collector, v: unknown, key: Seg): void {
  if (v === null) add(c, K.nullEmpty, key);
  else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") c.sawTyped = true;
  else if (typeof v !== "object") return;
  else if (isDate(v)) c.sawDate = true;
  else if (isBinary(v)) add(c, K.binaryNumbers, key);
  else if (Array.isArray(v)) add(c, K.arrayJoined, key);
  else add(c, K.objectString, key);
}

// --- dotenv (`${key}=${value}` per top-level entry) ------------------------------

/** The key pattern of dotenv's line regex; other keys are skipped or misread */
const DOTENV_KEY = /^[\w.-]+$/;
const DOTENV_CUT = /[\r\n#]/;

function dotenvLosses(c: Collector, value: unknown): void {
  if (Array.isArray(value)) {
    addRoot(c, K.rootArrayText);
    return;
  }
  // A primitive is written as itself
  if (!isContainer(value)) return;
  const path = c.path;
  for (const key of Object.keys(value)) {
    path.length = 0;
    path.push(key);
    const v = (value as Record<string, unknown>)[key];
    if (!DOTENV_KEY.test(key)) add(c, K.keyMangled);
    else if (v === null) add(c, K.nullText);
    else if (typeof v === "string") {
      // dotenv cuts an unquoted value at # or a line break, trims it and strips matching outer quotes
      if (DOTENV_CUT.test(v)) add(c, K.cut);
      else if (v !== v.trim() || isQuotedFor(v, "\"'`")) add(c, K.stripped);
    } else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") c.sawTyped = true;
    else if (typeof v !== "object") continue;
    else if (isDate(v)) add(c, K.dateMangled);
    else if (isBinary(v)) add(c, K.binaryNumbers);
    else if (Array.isArray(v)) add(c, K.arrayJoined);
    else add(c, K.objectString);
  }
  path.length = 0;
}

function isQuotedFor(s: string, quotes: string): boolean {
  return s.length > 1 && quotes.includes(s[0]) && s[s.length - 1] === s[0];
}

// --- INI (ini.stringify / ini.parse) ----------------------------------------------

/** ini.stringify writes these strings as JSON, which reads back exactly */
function iniQuotes(s: string): boolean {
  return /[=\r\n]/.test(s) || s.startsWith("[") || isQuotedFor(s, "\"'") || s !== s.trim();
}

function iniString(c: Collector, s: string, extra?: Seg): void {
  if (s === "true" || s === "false" || s === "null") add(c, K.retypedIni, extra);
  // Unquoted, ini only escapes ; and #, and reads \\ \; \# back as one character
  else if (s.includes("\\") && !iniQuotes(s) && /\\[\\;#]/.test(s)) add(c, K.backslash, extra);
}

/** Has a section of its own: a non-empty object or a byte array */
function iniHasSection(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !isDate(v) && (isBinary(v) || !isEmpty(v));
}

/**
 * A dotted section name stays escaped (`a\.b`) when it is the parent of another
 * section. ini.parse unescapes it only when the section has lines of its own.
 */
function iniDottedSectionMangled(obj: Record<string, unknown>): boolean {
  let hasChild = false;
  for (const key in obj) {
    const v = obj[key];
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) {
      if (v.length > 0) return false;
    } else if (iniHasSection(v)) hasChild = true;
  }
  return hasChild;
}

function iniLosses(c: Collector, value: unknown): void {
  if (typeof value === "string") {
    if (value) addRoot(c, K.rootSplit);
    return;
  }
  if (value === null || typeof value !== "object") {
    if (value !== undefined && value !== null) addRoot(c, K.rootDropped);
    return;
  }
  if (isDate(value)) return addRoot(c, K.dateDropped);
  if (isBinary(value)) return addRoot(c, K.binaryNumbers);
  if (Array.isArray(value)) addRoot(c, K.rootArrayObject);

  // Every visited value is an entry of a section; array items are checked in place
  walk(c, value, (v, key, depth) => {
    if (depth === 0) return true;
    const k = String(key);
    if (v === null || v === undefined || typeof v === "boolean") {
      // ini.parse splits a dotted top-level key as a section name when its value is null
      if (iniBadValueKey(k) || (v === null && depth === 1 && k.includes("."))) add(c, K.keyMangled);
      return false;
    }
    if (typeof v === "string") {
      if (iniBadValueKey(k)) add(c, K.keyMangled);
      else iniString(c, v);
      return false;
    }
    if (typeof v === "number" || typeof v === "bigint") {
      if (iniBadValueKey(k)) add(c, K.keyMangled);
      else if (typeof v === "number" && !Number.isFinite(v)) add(c, K.nanNull);
      else c.sawTyped = true;
      return false;
    }
    if (typeof v !== "object") return false;
    if (isDate(v)) {
      add(c, K.dateDropped);
      return false;
    }
    if (isBinary(v)) {
      add(c, K.binaryNumbers);
      return false;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) add(c, K.emptyArray);
      else if (k === "" || k.includes("=")) add(c, K.keyMangled);
      else iniArrayItems(c, v);
      return false;
    }
    if (isEmpty(v)) {
      add(c, K.emptyObject);
      return false;
    }
    // A section named "" is written as part of its parent
    if (k === "" || k.includes("]") || (k.includes(".") && iniDottedSectionMangled(v as Record<string, unknown>))) {
      add(c, K.keyMangled);
    }
    return true;
  });
}

/** `key=value` lines: no key, a key with =, or a key ending in [] does not read back */
function iniBadValueKey(k: string): boolean {
  return k === "" || k.includes("=") || (k.length > 2 && k.endsWith("[]"));
}

function iniArrayItems(c: Collector, items: unknown[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item === "string") iniString(c, item, i);
    else if (typeof item === "number") {
      if (!Number.isFinite(item)) add(c, K.nanNull, i);
      else c.sawTyped = true;
    } else if (item === null || typeof item !== "object") continue;
    else if (isDate(item)) add(c, K.dateString, i);
    else add(c, K.jsonText, i);
  }
}

// --- Query string (qs.stringify / qs.parse with default options) -----------------

/** qs.parse defaults: arrayLimit 20, depth 5, parameterLimit 1000 */
const QS_ARRAY_LIMIT = 20;
const QS_MAX_PATH = 6;
const QS_PARAMETER_LIMIT = 1000;
const QS_TOP_BRACKETS = /\[[^[\]]*]/;

function queryLosses(c: Collector, value: unknown): void {
  if (value === null || typeof value !== "object") {
    if (value !== undefined) addRoot(c, K.rootDropped);
    return;
  }
  if (isDate(value)) return addRoot(c, K.rootDropped);
  if (Array.isArray(value) || isBinary(value)) addRoot(c, K.rootArrayObject);
  if (isBinary(value)) return;

  let pairs = 0;
  const pair = (depth: number, extra?: Seg) => {
    pairs++;
    if (pairs > QS_PARAMETER_LIMIT) add(c, K.queryLimit, extra);
    else if (depth > QS_MAX_PATH) add(c, K.queryDepth, extra);
  };

  walk(c, value, (v, key, depth) => {
    if (depth === 0) return true;
    // qs reads [...] in a key as nesting, and an empty key as an array push or nothing
    if (typeof key === "string" && (key === "" || (depth === 1 ? QS_TOP_BRACKETS.test(key) : key.includes("[") || key.includes("]")))) {
      add(c, K.keyMangled);
    }
    if (v === undefined) return false;
    if (v !== null && typeof v === "object" && !isDate(v)) {
      if (isBinary(v)) {
        add(c, K.binaryNumbers);
        const length = (v as unknown as ArrayLike<number>).length ?? 0;
        for (let i = 0; i < length; i++) pair(depth + 1, i);
        return false;
      }
      if (isEmpty(v)) {
        add(c, Array.isArray(v) ? K.emptyArray : K.emptyObject);
        return false;
      }
      if (Array.isArray(v) && v.length > QS_ARRAY_LIMIT) add(c, K.queryArray);
      return true;
    }
    pair(depth);
    if (v === null) add(c, K.nullEmpty);
    else if (isDate(v)) c.sawDate = true;
    else if (typeof v !== "string") c.sawTyped = true;
    return false;
  });
}

// --- XML (fast-xml-parser XMLBuilder / XMLParser with the app's options) -------

/** Whitespace, quotes and > end a tag name early */
const XML_BAD_NAME = /[\s>"']/;
const XML_HEX = /^[-+]?0x[a-fA-F0-9]+$/;
const XML_NUMBER = /^([-+])?(0*)(\.[0-9]+([eE]-?[0-9]+)?|[0-9]+(\.[0-9]+([eE]-?[0-9]+)?)?)$/;

/** Mirrors strnum 1.0.5 (fast-xml-parser's number parsing) with the default options */
export function xmlReadsAsNumber(text: string): boolean {
  if (!text) return false;
  if (XML_HEX.test(text)) return true;
  const match = XML_NUMBER.exec(text);
  if (!match) return false;
  const sign = String(match[1]);
  const leadingZeros = match[2];
  const digits = trimZeros(match[3]);
  const numStr = "" + Number(text);
  if (numStr.search(/[eE]/) !== -1) return true;
  if (match[4] || match[6]) return true;
  if (text.includes(".")) {
    return (numStr === "0" && digits === "") || numStr === digits || (match[1] !== undefined && numStr === "-" + digits);
  }
  if (leadingZeros) return digits === numStr || sign + digits === numStr;
  return text === numStr || text === sign + numStr;
}

function trimZeros(numStr: string): string {
  if (!numStr.includes(".")) return numStr;
  numStr = numStr.replace(/0+$/, "");
  if (numStr === ".") return "0";
  if (numStr[0] === ".") return "0" + numStr;
  if (numStr[numStr.length - 1] === ".") return numStr.slice(0, -1);
  return numStr;
}

function xmlLosses(c: Collector, value: unknown): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value) addRoot(c, K.rootSplit);
    else if (value !== undefined && value !== "") addRoot(c, K.rootDropped);
    return;
  }
  if (isDate(value)) return addRoot(c, K.dateMangled);
  if (isBinary(value)) return addRoot(c, K.binaryNumbers);
  const rootArray = Array.isArray(value) ? (value as unknown[]) : null;
  const rootIsArray = rootArray !== null;
  // The writer builds { root: { item: value } } for an array
  if (rootIsArray) c.rules.push("root array wrapped in <root><item>");

  walk(c, value, (v, key, depth, parent) => {
    if (depth === 0) {
      if (!rootArray) return true;
      if (rootArray.length === 0) addRoot(c, K.emptyArray);
      else if (rootArray.length === 1) addRoot(c, K.singleArray);
      return rootArray.length > 0;
    }
    const isAttribute = typeof key === "string" && key.startsWith("@_");
    if (typeof key === "string") {
      // As elements, object values still read back
      if (depth === 1 && !rootIsArray && (isAttribute || key === "#text") && (v === null || typeof v !== "object")) {
        add(c, K.rootKeys);
        return false;
      }
      if (!isAttribute && key !== "#text" && XML_BAD_NAME.test(key)) {
        add(c, K.keyMangled);
        return false;
      }
    }
    if (isAttribute && (v === null || typeof v !== "object")) {
      // Attribute values are not parsed back, and a value of "true" is written as a bare name
      if (v === null || v === true || v === "true") add(c, K.attrDropped);
      else if (typeof v === "string") xmlText(c, v, v.trim());
      else if (v !== undefined) add(c, K.attrText);
      return false;
    }
    if (v === null) {
      add(c, K.nullEmpty);
      return false;
    }
    if (typeof v === "string") {
      xmlString(c, v);
      return false;
    }
    if (typeof v === "number") {
      // Plain decimals always read back; only exponents, NaN and Infinity can fail
      const abs = Math.abs(v);
      if (!(abs < 1e21 && (abs >= 1e-6 || v === 0)) && !xmlReadsAsNumber(String(v))) add(c, K.numberText);
      return false;
    }
    if (typeof v !== "object") return false;
    if (isDate(v)) {
      add(c, K.dateMangled);
      return false;
    }
    if (isBinary(v)) {
      add(c, K.binaryNumbers);
      return false;
    }
    if (Array.isArray(v)) {
      // An array inside an array is written as elements named 0, 1, ...
      if (Array.isArray(parent)) {
        add(c, K.nestedArray);
        return false;
      }
      if (v.length === 0) add(c, K.emptyArray);
      else if (v.length === 1) add(c, K.singleArray);
      return v.length > 0;
    }
    if (isEmpty(v)) {
      add(c, K.emptyObjectText);
      return false;
    }
    if (xmlTextOnly(v as Record<string, unknown>)) add(c, K.textOnly);
    return true;
  });
}

function xmlString(c: Collector, v: string): void {
  const first = v.charCodeAt(0);
  const last = v.charCodeAt(v.length - 1);
  // Fast path: printable ASCII at both ends means trim() changes nothing, and
  // only a digit, sign, dot, t or f can start a number or boolean
  if (first > 32 && first < 127 && last > 32 && last < 127) {
    const maybeTyped = (first >= 48 && first <= 57) || first === 43 || first === 45 || first === 46 || first === 116 || first === 102;
    if (maybeTyped && (v === "true" || v === "false" || xmlReadsAsNumber(v))) add(c, K.retypedXml);
    else if (v.includes("\r")) add(c, K.carriageReturn);
    return;
  }
  const text = v.trim();
  if (text === "true" || text === "false" || xmlReadsAsNumber(text)) add(c, K.retypedXml);
  else xmlText(c, v, text);
}

/** The parser trims values and turns \r\n and \r into \n */
function xmlText(c: Collector, value: string, trimmed: string): void {
  if (trimmed !== value) add(c, K.trimmed);
  else if (value.includes("\r")) add(c, K.carriageReturn);
}

/** { "#text": x } with no attributes or children reads back as just x */
function xmlTextOnly(obj: Record<string, unknown>): boolean {
  let only = false;
  for (const key in obj) {
    if (key !== "#text") return false;
    only = obj[key] === null || typeof obj[key] !== "object";
  }
  return only;
}
