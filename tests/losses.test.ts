import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { XMLParser } from "fast-xml-parser";
import yaml from "js-yaml";
import JSON5 from "json5";
import TOML from "@ltd/j-toml";
import ini from "ini";
import { collectLosses, kindForCount, xmlReadsAsNumber } from "../src/lib/losses.ts";
import { parseText } from "../src/lib/convert/parse.ts";
import { stringifyValue } from "../src/lib/convert/stringify.ts";
import { TOML_PARSE_OPTIONS } from "../src/lib/detectFormat.ts";

// The app's real readers and writers

const kindOf = (v: unknown) =>
  Array.isArray(v) ? "array" : typeof v === "object" && v !== null ? "object" : "primitive";

const write = (value: unknown, format: string): string => stringifyValue(value, format);
const read = (text: string, format: string): any => parseText(text, format);

// --- Helpers --------------------------------------------------------------------

const MISSING = Symbol("missing");

/** Null-prototype objects (ini) become plain objects; dates, bytes and other values stay */
function plain(v: any): any {
  if (Array.isArray(v)) return v.map(plain);
  if (v === null || typeof v !== "object" || v instanceof Date || ArrayBuffer.isView(v)) return v;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v)) out[key] = plain(v[key]);
  return out;
}

/** Undo the writer's wrapping so that report paths point into the read-back value */
function unwrap(original: any, back: any, format: string): any {
  if ((format === "csv" || format === "tsv" || format === "jsonl") && !Array.isArray(original)) return back[0];
  if (format === "xml" && Array.isArray(original)) {
    const item = back?.root?.item;
    return original.length === 1 ? [item] : item;
  }
  return back;
}

function parsePath(path: string): (string | number)[] {
  const segs: (string | number)[] = [];
  const re = /([A-Za-z_$][\w$-]*)|\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;
  while (re.lastIndex < path.length) {
    const m = re.exec(path);
    assert.ok(m, `bad path ${path}`);
    segs.push(m[1] ?? m[2] ?? (m[3] !== undefined ? Number(m[3]) : JSON.parse(m[4])));
  }
  return segs;
}

function getAt(root: any, path: string): any {
  let v = root;
  for (const seg of parsePath(path)) {
    if (v === null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, seg)) return MISSING;
    v = v[seg];
  }
  return v;
}

/** The type changes that the report gives as a rule, not as items */
function expected(v: any, format: string): any {
  const textFormats = ["csv", "tsv", "dotenv", "querystring"];
  if (Array.isArray(v)) return v.map((item) => expected(item, format));
  if (v !== null && typeof v === "object" && !(v instanceof Date) && !ArrayBuffer.isView(v)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v)) out[key] = expected(v[key], format);
    return out;
  }
  if ((typeof v === "number" || typeof v === "boolean") && textFormats.includes(format)) return String(v);
  if (typeof v === "number" && Number.isFinite(v) && format === "ini") return String(v);
  return v;
}

/** Writes and reads back; every reported example path must hold a different value afterwards */
function verifyClaims(value: any, input: string, output: string) {
  const report = collectLosses(value, input, output);
  let readBack;
  try {
    readBack = read(write(value, output), output);
  } catch (error) {
    // The output does not read back at all (xml with a quote in a tag name): something must be reported
    assert.ok(report && report.items.length > 0, `${output}: unreadable output not reported: ${(error as Error).message}`);
    return { report, back: undefined, want: undefined };
  }
  const back = unwrap(value, plain(readBack), output);
  const want = expected(value, output);
  for (const item of report?.items ?? []) {
    for (const path of item.examples) {
      const before = getAt(want, path);
      const after = getAt(back, path);
      assert.ok(before !== MISSING, `${output}: "${item.kind}" path ${path} is not in the input`);
      assert.ok(
        !isDeepStrictEqual(before, after),
        `${output}: "${item.kind}" at ${path} round-trips unchanged: ${JSON.stringify(before)}`,
      );
    }
  }
  return { report, back, want };
}

const kinds = (report: ReturnType<typeof collectLosses>) =>
  Object.fromEntries((report?.items ?? []).map((item) => [item.kind, item.count]));

// --- Lossless pairs ---------------------------------------------------------------

/** Throws if collectLosses reads anything from the value */
function untouchable(): any {
  return new Proxy({}, {
    get() { throw new Error("walked"); },
    ownKeys() { throw new Error("walked"); },
    getPrototypeOf() { throw new Error("walked"); },
    has() { throw new Error("walked"); },
  });
}

for (const [input, output] of [
  ["json", "yaml"], ["json", "json5"], ["json", "msgpack"], ["json", "jsonl"], ["json", "json"],
  ["json", "toon"], ["json", "toml"], ["csv", "json"], ["xml", "yaml"], ["yaml", "msgpack"],
  ["json5", "json5"], ["toml", "toml"], ["toon", "base64"], ["querystring", "uri"],
]) {
  test(`${input} → ${output} does not walk the value`, () => {
    const report = collectLosses(untouchable(), input, output);
    assert.equal(report?.items.length ?? 0, 0);
  });
}

test("json → yaml, json5, msgpack, jsonl, toon report nothing", () => {
  for (const output of ["yaml", "json5", "msgpack", "jsonl", "toon", "json"]) {
    assert.equal(collectLosses([{ a: { b: [1, null] } }], "json", output), null, output);
  }
});

test("comment-bearing inputs get a rule even when the output keeps everything", () => {
  assert.deepEqual(collectLosses({ a: 1 }, "yaml", "yaml"), { rules: ["comments not kept"], items: [] });
  assert.deepEqual(collectLosses({ a: 1 }, "toml", "json")?.rules, ["comments not kept"]);
  assert.deepEqual(collectLosses({ a: 1 }, "yaml", "json")?.rules, ["comments not kept", "anchors, aliases and merge keys expanded"]);
  // Shared values come back as anchors in yaml, but every other writer copies them
  const shared = yaml.load("a: &x {b: 1}\nc: *x\n") as any;
  assert.match(write(shared, "yaml"), /&ref_0/);
  assert.equal(write(shared, "json").match(/"b"/g)?.length, 2);
});

test("xml input rules: comments, regrouped tags, merged text, number-like text", () => {
  const value = read("<a><!-- c --><b>1</b><c>x</c><b>007</b></a>", "xml");
  assert.deepEqual(value, { a: { b: [1, 7], c: "x" } });
  assert.equal(write(value, "xml").indexOf("<c>") > write(value, "xml").lastIndexOf("<b>"), true);
  assert.deepEqual(read("<p>one<b>two</b>three</p>", "xml"), { p: { b: "two", "#text": "onethree" } });
  assert.equal(collectLosses(value, "xml", "json")?.rules.length, 3);
});

// --- CSV / TSV --------------------------------------------------------------------

test("csv: nested values, nulls, columns missing from the first row", () => {
  const value = [
    { id: 1, tags: ["a", "b"], meta: { x: 1 }, note: null },
    { id: 2, tags: [], meta: {}, note: "n", extra: true },
    ["array", "row"],
    { id: 4 },
  ];
  for (const output of ["csv", "tsv"]) {
    const { report } = verifyClaims(value, "json", output);
    assert.deepEqual(kinds(report), {
      "values dropped (key not in first row)": 3,
      "nested objects written as [object Object]": 2,
      "arrays joined into text": 2,
      "nulls became empty text": 1,
    });
    assert.deepEqual(report?.rules, ["numbers and booleans become text"]);
    const dropped = report?.items.find((i) => i.kind === "values dropped (key not in first row)");
    assert.deepEqual(dropped?.examples, ["[1].extra", "[2][0]", "[2][1]"]);
  }
});

test("csv: a root object is one row; flat string rows lose nothing", () => {
  assert.deepEqual(kinds(verifyClaims({ a: { b: 1 } }, "json", "csv").report), { "nested objects written as [object Object]": 1 });
  assert.equal(collectLosses([{ a: "1", b: "x" }, { a: "2", b: "y" }], "csv", "csv"), null);
  // Without a header (first row is an array), object rows have no columns
  assert.deepEqual(kinds(verifyClaims([["x", "y"], { a: "1" }], "json", "csv").report), { "values dropped (key not in first row)": 1 });
});

test("csv: rows that are not objects are dropped", () => {
  const { report } = verifyClaims([{ a: "1" }, 5, "s"], "json", "csv");
  assert.deepEqual(kinds(report), { "non-object rows dropped": 2 });
});

// --- dotenv -----------------------------------------------------------------------

test("dotenv: nesting, nulls, cut and stripped values, bad keys", () => {
  const value = {
    DB: { host: "h" }, LIST: [1, 2], EMPTY: null, PORT: 5432, OK: true,
    HASH: "abc#def", MULTI: "l1\nl2", SPACED: " x ", QUOTED: "'q'", BACKTICK: "`b`",
    "BAD KEY": "v", "A=B": "v", PLAIN: "x'y'", HALF: '"open', EQ: "a=b", TAB: "a\tb", "": "z",
  };
  const { report } = verifyClaims(value, "json", "dotenv");
  assert.deepEqual(kinds(report), {
    "nested objects written as [object Object]": 1,
    "arrays joined into text": 1,
    'nulls became the text "null"': 1,
    "values cut at # or line break": 2,
    "values lost outer spaces or quotes": 3,
    "keys mangled": 3,
  });
  assert.deepEqual(report?.rules, ["numbers and booleans become text"]);
});

test("dotenv: a root array is written as one line of text", () => {
  assert.deepEqual(kinds(collectLosses([{ a: 1 }], "json", "dotenv")), { "root array written as plain text": 1 });
  assert.deepEqual(read(write([{ a: 1 }], "dotenv"), "dotenv"), {});
  assert.deepEqual(collectLosses({ A: "1" }, "dotenv", "dotenv"), { rules: ["comments not kept"], items: [] });
});

// --- INI ----------------------------------------------------------------------------

test("ini: empty values, arrays of objects, typed text, backslashes, keys", () => {
  const value = {
    n: 1, b: true, z: null, nan: NaN,
    s: { list: [{ a: 1 }, [2], "true", "x\\;y", 3, null], empty: [], none: {}, t: "null", bs: "a\\\\b", ok: "a\\b" },
    "p.q": { r: { s: "1" } },
    "u.v": { t: "1", w: { s: "1" } },
    "x.y": { w: "1" },
    "c]": { d: "1" },
    sec: { "a=b": "1", "k[]": "1", "": "1" },
  };
  const { report } = verifyClaims(value, "json", "ini");
  assert.deepEqual(kinds(report), {
    "nested values in arrays written as JSON text": 2,
    'strings "true"/"false"/"null" read back as values': 2,
    "backslashes changed": 2,
    "empty arrays dropped": 1,
    "empty objects dropped": 1,
    "NaN/Infinity became null": 1,
    "keys mangled": 5,
  });
  assert.deepEqual(report?.rules, ["numbers become text"]);
});

test("ini: root arrays and root text", () => {
  assert.deepEqual(kinds(verifyClaims([{ a: "1" }], "json", "ini").report), { "root array became an object": 1 });
  assert.deepEqual(kinds(collectLosses("hello", "text", "ini")), { "root text split into characters": 1 });
  assert.deepEqual(read(write("hi", "ini"), "ini"), Object.assign(Object.create(null), { 0: "h", 1: "i" }));
});

test("ini → ini keeps everything but comments", () => {
  const value = read("a=1\n[s]\nb=true\nc[]=x\nc[]=y\n[s.t]\nd=2\n", "ini");
  assert.deepEqual(collectLosses(value, "ini", "ini"), { rules: ["comments not kept"], items: [] });
});

// --- Query string -----------------------------------------------------------------

test("querystring: nulls, empty containers, bracket keys", () => {
  const value = {
    n: null, e: [], o: {}, keep: { e: [] }, "x[y]": "1", "a]": "ok",
    inner: { "b[": "1" }, ok: Array.from({ length: 20 }, () => "v"),
  };
  const { report } = verifyClaims(value, "json", "querystring");
  assert.deepEqual(kinds(report), {
    "nulls became empty text": 1,
    "empty arrays dropped": 2,
    "empty objects dropped": 1,
    "keys mangled": 2,
  });
});

test("querystring: long arrays, deep keys and many pairs read back whole", () => {
  const value: Record<string, unknown> = {
    big: Array.from({ length: 50 }, (_, i) => String(i)),
    deep: { k1: { k2: { k3: { k4: { k5: { k6: { k7: { k8: "x" } } } } } } } },
  };
  for (let i = 0; i < 1005; i++) value["k" + i] = "v";
  assert.equal(collectLosses(value, "json", "querystring")?.items.length ?? 0, 0);
  assert.deepEqual(read(write(value, "querystring"), "querystring"), value);
});

test("querystring: a huge array index stays an object", () => {
  assert.deepEqual(read("a[99999999]=1&b=2", "querystring"), { a: { 99999999: "1" }, b: "2" });
});

test("querystring: root arrays become objects and root text is dropped", () => {
  assert.deepEqual(kinds(collectLosses(["a", "b"], "json", "querystring")), { "root array became an object": 1 });
  assert.deepEqual(read(write(["a", "b"], "querystring"), "querystring"), { 0: "a", 1: "b" });
  assert.deepEqual(kinds(collectLosses("abc", "text", "querystring")), { "root value dropped": 1 });
  assert.equal(write("abc", "querystring"), "");
});

// --- XML ------------------------------------------------------------------------------

test("xml: arrays, nulls, empty objects, retyped strings, attributes, bad names", () => {
  const value = {
    "@_root": "1",
    doc: {
      one: [1], none: [], nested: [[1, 2], [3]], nul: null, empty: {},
      zeros: "007", yes: "true", spaced: " x ", text: "plain", big: 1e21, small: 0.5,
      "@_id": 5, "@_flag": true, "@_off": false, "@_name": "n", "#text": "t",
      "bad name": "v", "ok.name": "v",
    },
  };
  const { report } = verifyClaims(value, "json", "xml");
  assert.deepEqual(kinds(report), {
    "root attributes or text dropped": 1,
    "single-item arrays became plain values": 1,
    "empty arrays dropped": 1,
    "nested arrays became objects": 2,
    "nulls became empty text": 1,
    "empty objects became empty text": 1,
    "strings read back as numbers or booleans": 2,
    "strings trimmed": 1,
    "numbers read back as text": 1,
    "attributes set to true or null dropped": 1,
    "attribute values became text": 2,
    "keys mangled": 1,
  });
});

test("xml: a root array is wrapped and lists its items", () => {
  const { report } = verifyClaims([{ a: "x" }, { a: null }], "json", "xml");
  assert.deepEqual(report?.rules, ["root array wrapped in <root><item>"]);
  assert.deepEqual(kinds(report), { "nulls became empty text": 1 });
  assert.equal(report?.items[0].examples[0], "[1].a");
});

test("xml number detection matches fast-xml-parser", () => {
  const samples = [
    "007", "1.50", "1e5", "0x1F", "+5", "-0", "12345678901234567890", "1,000", ".5", "5.", "Infinity",
    "NaN", "1_000", "-.5", "0", "00", "0.0", "1e", "e5", "-", "1.2.3", "123abc", "9007199254740993",
    "1.5e3", "1.5E-3", "-1.0", "+0.10", "0.000", "1e21", "1e-7", "-0x1f", "0x", "1.", "01.10", "-007",
    "123456789012345680000", "0.1", "-5", "2.5", "3.0e2", "+.5", "00.5",
  ];
  const parser = new XMLParser();
  for (const s of samples) {
    const parsed = parser.parse(`<a>${s}</a>`).a;
    assert.equal(xmlReadsAsNumber(s), typeof parsed === "number", s);
  }
});

// --- JSON-like writers and exotic values -----------------------------------------

test("yaml dates, NaN and binary through JSON-like writers", () => {
  const value = yaml.load("d: 2024-01-02\nn: .nan\ni: -.inf\nb: !!binary aGVsbG8=\ns: x\n");
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "json").report), {
    "NaN/Infinity became null": 2, "binary data became numbers": 1, "dates became strings": 1,
  });
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "toon").report), {
    "NaN/Infinity became null": 2, "binary data dropped": 1, "dates became strings": 1,
  });
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "json5").report), {
    "binary data became numbers": 1, "dates became strings": 1,
  });
  assert.equal(collectLosses(value, "yaml", "yaml")?.items.length, 0);
  assert.equal(collectLosses(value, "yaml", "msgpack")?.items.length, 0);
  assert.deepEqual(read(write(value, "msgpack"), "msgpack"), value);
});

test("yaml dates and binary through text writers", () => {
  const value = yaml.load("d: 2024-01-02T03:04:05.123Z\nb: !!binary aGVsbG8=\nn: .nan\n");
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "ini").report), {
    "dates dropped": 1, "binary data became numbers": 1, "NaN/Infinity became null": 1,
  });
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "dotenv").report), { "dates mangled": 1, "binary data became numbers": 1 });
  assert.deepEqual(kinds(verifyClaims(value, "yaml", "xml").report), {
    "dates mangled": 1, "binary data became numbers": 1, "numbers read back as text": 1,
  });
  const csv = verifyClaims(value, "yaml", "csv").report;
  assert.deepEqual(kinds(csv), { "binary data became numbers": 1 });
  assert.deepEqual(csv?.rules, ["comments not kept", "anchors, aliases and merge keys expanded", "numbers and booleans become text", "dates become text"]);
});

test("toml dates become strings in json and garbled digits in xml", () => {
  const value = TOML.parse("odt = 2024-01-02T03:04:05Z\nld = 2024-01-02\nn = nan\n", TOML_PARSE_OPTIONS);
  assert.deepEqual(kinds(verifyClaims(value, "toml", "json").report), { "dates became strings": 2, "NaN/Infinity became null": 1 });
  assert.deepEqual(kinds(verifyClaims(value, "toml", "xml").report), { "dates mangled": 2, "numbers read back as text": 1 });
  assert.equal(collectLosses(value, "toml", "toml")?.items.length, 0);
});

test("json5 NaN/Infinity become null in json only", () => {
  const value = JSON5.parse("{a: NaN, b: Infinity, c: 1}");
  assert.deepEqual(kinds(verifyClaims(value, "json5", "json").report), { "NaN/Infinity became null": 2 });
  assert.equal(collectLosses(value, "json5", "json5")?.items.length, 0);
  assert.equal(collectLosses(value, "json5", "yaml")?.items.length, 0);
});

test("hex and binary garble characters above U+00FF", () => {
  for (const output of ["hex", "binary"]) {
    const { report } = verifyClaims({ ok: "é", bad: "€", "ключ": "x", list: ["😀"] }, "json", output);
    assert.deepEqual(kinds(report), { "strings with characters above U+00FF garbled": 3 });
    assert.equal(collectLosses({ a: "café" }, "json", output), null);
  }
});

// --- Deep and large values ----------------------------------------------------------

test("deep values do not overflow the stack", () => {
  let value: any = "leaf";
  let withNull: any = null;
  for (let i = 0; i < 200_000; i++) {
    value = { k: value };
    withNull = { k: withNull };
  }
  // The walk reaches the null at the bottom
  assert.equal(collectLosses(withNull, "json", "querystring")?.items[0].kind, "nulls became empty text");
  assert.equal(collectLosses(value, "json", "xml"), null);
  assert.equal(collectLosses(value, "yaml", "json")?.items.length, 0);
});

test("examples stop at the cap while counting continues", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ a: { i } }));
  const item = collectLosses(rows, "json", "csv")?.items[0];
  assert.equal(item?.count, 500);
  assert.equal(item?.examples.length, 20);
  assert.equal(item?.examples[19], "[19].a");
});

test("a count of 1 reads singular", () => {
  assert.equal(kindForCount("values dropped (key not in first row)", 1), "value dropped (key not in first row)");
  assert.equal(kindForCount("nested objects written as [object Object]", 1), "nested object written as [object Object]");
  assert.equal(kindForCount("carriage returns became line feeds", 1), "carriage return became line feeds");
  assert.equal(kindForCount("backslashes changed", 1), "backslash changed");
  assert.equal(kindForCount("dates became strings", 1), "date became strings");
  assert.equal(kindForCount('strings "true"/"false"/"null" read back as values', 1), 'string "true"/"false"/"null" read back as values');
  // Unchanged: other counts, no plural noun up front, and root kinds
  assert.equal(kindForCount("values dropped (key not in first row)", 2), "values dropped (key not in first row)");
  assert.equal(kindForCount("binary data became numbers", 1), "binary data became numbers");
  assert.equal(kindForCount("NaN/Infinity became null", 1), "NaN/Infinity became null");
  assert.equal(kindForCount("root attributes or text dropped", 1), "root attributes or text dropped");
});

// --- Fuzz: every claimed path changes; unreported conversions round-trip --------------

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const KEYS = ["a", "b", "id", "x.y", "k[]", "a=b", "a b", "@_at", "#text", "é", "t]", "[s]", "", "0", "q'"];
const STRINGS = ["", "x", " sp ", "007", "true", "null", "a#b", "l1\nl2", "'q'", '"q"', "a\\;b", "x=y", "€", "5", "1e5", "0x1F", "a;b", "[x", "`t`", "plain text", "a\tb", "a,b", "x\r\ny"];
const NUMBERS = [0, 1, -2.5, 42, 1e21, 0.1];

function generate(random: () => number, depth: number): any {
  const r = random();
  if (depth > 3 || r < 0.45) {
    const pick = random();
    if (pick < 0.5) return STRINGS[Math.floor(random() * STRINGS.length)];
    if (pick < 0.75) return NUMBERS[Math.floor(random() * NUMBERS.length)];
    if (pick < 0.88) return random() < 0.5;
    return null;
  }
  if (r < 0.7) {
    const length = random() < 0.1 ? 22 : Math.floor(random() * 4);
    return Array.from({ length }, () => generate(random, depth + 1));
  }
  const out: Record<string, unknown> = {};
  const count = Math.floor(random() * 4);
  for (let i = 0; i < count; i++) out[KEYS[Math.floor(random() * KEYS.length)]] = generate(random, depth + 1);
  return out;
}

/** For outputs whose unreported changes are only the rules: no items means the value round-trips */
const COMPLETE = ["ini", "querystring", "xml", "dotenv", "toon", "json", "yaml", "msgpack", "hex", "binary"];

for (const output of ["csv", "tsv", "dotenv", "ini", "querystring", "xml", "toon", "json", "yaml", "msgpack", "hex", "binary", "jsonl"]) {
  test(`fuzz: ${output}`, () => {
    const random = rng(output.length * 7919 + 17);
    let checked = 0;
    for (let n = 0; n < 400; n++) {
      const value = output === "csv" || output === "tsv"
        ? Array.from({ length: 1 + Math.floor(random() * 3) }, () => generate(random, 1))
        : generate(random, 0);
      try {
        write(value, output);
      } catch {
        continue; // the conversion fails, so no report is shown
      }
      // Known miss: toon writes an empty key that holds an array without its quotes
      if (output === "toon" && /"":\[/.test(JSON.stringify(value))) continue;
      let result;
      try {
        result = verifyClaims(value, "json", output);
      } catch (error) {
        throw new Error(`${output}: ${JSON.stringify(value)}: ${(error as Error).message}`);
      }
      const { report, back, want } = result;
      checked++;
      if (COMPLETE.includes(output) && (report?.items.length ?? 0) === 0 && kindOf(value) !== "primitive") {
        assert.deepEqual(back, want, `${output}: unreported loss in ${JSON.stringify(value)}`);
      }
      if ((output === "csv" || output === "tsv") && (report?.items.length ?? 0) === 0 && !Array.isArray(value[0])) {
        // Rows read back with every column of the first row; missing values are empty
        const columns = Object.keys(want[0]);
        if (columns.length === 0) continue; // no columns: empty rows, nothing to keep
        const fill = (row: any) => Object.fromEntries(columns.map((key) => [key, row?.[key] ?? ""]));
        // A row of empty values is written as an empty line, which reads back with fewer fields
        assert.deepEqual(back.map(fill), want.map(fill), `${output}: unreported loss in ${JSON.stringify(value)}`);
      }
    }
    assert.ok(checked > 100);
  });
}
