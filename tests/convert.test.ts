import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseText } from "../src/lib/convert/parse.ts";
import { stringifyValue } from "../src/lib/convert/stringify.ts";
import { decodeJwt } from "../src/lib/decodeChain.ts";
import yaml from "js-yaml";

const testData = path.join(import.meta.dirname, "..", "test-data");

// Every sample parses with its folder's format and survives a JSON round trip
for (const format of fs.readdirSync(testData).sort()) {
  const dir = path.join(testData, format);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    test(`test-data/${format}/${file} parses as ${format} and round-trips through JSON`, () => {
      const value = parseText(fs.readFileSync(path.join(dir, file), "utf8"), format);
      const json = stringifyValue(value, "json");
      assert.deepEqual(parseText(json, "json"), JSON.parse(JSON.stringify(value) ?? "null"));
    });
  }
}

test("structured samples round-trip through their own format", () => {
  for (const [format, file] of [
    ["json", "json/users.json"],
    ["yaml", "yaml/config.yaml"],
    ["toml", "toml/config.toml"],
    ["jsonl", "jsonl/users.jsonl"],
    ["msgpack", "msgpack/users.txt"],
    ["toon", "toon/users.toon"],
  ]) {
    const value = parseText(fs.readFileSync(path.join(testData, file), "utf8"), format);
    assert.deepEqual(parseText(stringifyValue(value, format), format), value, format);
  }
});

test("text and unknown formats pass the text through", () => {
  assert.equal(parseText("hello", "text"), "hello");
  assert.equal(stringifyValue("hello", "text"), "hello");
  assert.equal(stringifyValue({ a: 1 }, "text"), '{"a":1}');
  assert.equal(stringifyValue(undefined, "json"), "");
  assert.equal(stringifyValue(42, "text"), "42");
});

test("encodings decode to JSON when they hold JSON, otherwise to text", () => {
  assert.deepEqual(parseText(btoa('{"a":1}'), "base64"), { a: 1 });
  assert.equal(parseText(btoa("hi"), "base64"), "hi");
  assert.deepEqual(parseText("7b2261223a317d", "hex"), { a: 1 });
  assert.equal(parseText("01101000 01101001", "binary"), "hi");
  assert.equal(parseText("a%20b", "uri"), "a b");
  assert.equal(parseText("", "hex"), "");
});

test("encodings read and write UTF-8, and keep bytes that are not text", () => {
  for (const format of ["base64", "hex", "binary"]) {
    for (const text of ["café €", "ключ 😀"]) {
      assert.equal(parseText(stringifyValue(text, format), format), text);
    }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const read = parseText(stringifyValue(bytes, format), format);
    assert.ok(read instanceof Uint8Array);
    assert.deepEqual([...(read as Uint8Array)], [...bytes]);
  }
  assert.equal(stringifyValue("é", "hex"), "c3a9");
  assert.equal(stringifyValue("é", "binary"), "11000011 10101001");
  assert.equal(parseText("Y2Fmw6k", "base64"), "café");
  assert.deepEqual(parseText("_w", "base64"), new Uint8Array([0xff]));
  assert.throws(() => parseText("7g", "hex"), /not a hex digit/);
  assert.throws(() => parseText("abc", "hex"), /odd number/);
  assert.throws(() => parseText("0101", "binary"), /8-bit/);
  assert.throws(() => parseText("@@@@", "base64"), /not valid Base64/);
});

test("writers treat arrays, objects and primitives differently", () => {
  // XML wraps a root array; TOML needs a table at the root
  assert.match(stringifyValue([1, 2], "xml"), /<root>\s*<item>1<\/item>\s*<item>2<\/item>\s*<\/root>/);
  assert.throws(() => stringifyValue([1], "toml"), /TOML requires an object/);
  assert.throws(() => stringifyValue("x", "toml"), /TOML requires an object/);
  // CSV, TSV and JSONL write a lone object as one row
  assert.equal(stringifyValue({ a: 1, b: 2 }, "csv"), "a,b\r\n1,2");
  assert.equal(stringifyValue({ a: 1, b: 2 }, "tsv"), "a\tb\r\n1\t2");
  assert.equal(stringifyValue({ a: 1 }, "jsonl"), '{"a":1}');
  assert.equal(stringifyValue([{ a: 1 }, { a: 2 }], "jsonl"), '{"a":1}\n{"a":2}');
  // dotenv writes key=value for objects and the value itself otherwise
  assert.equal(stringifyValue({ A: 1, B: "x" }, "dotenv"), "A=1\nB=x");
  assert.equal(stringifyValue("plain", "dotenv"), "plain");
  // Encodings write primitives as they are and anything else as compact JSON
  assert.equal(stringifyValue("hi", "hex"), "6869");
  assert.equal(stringifyValue({ a: 1 }, "uri"), "%7B%22a%22%3A1%7D");
  assert.equal(stringifyValue("hi", "binary"), "01101000 01101001");
  assert.equal(stringifyValue("é", "base64"), "w6k=");
  assert.equal(stringifyValue({ a: [1, 2] }, "querystring"), "a%5B0%5D=1&a%5B1%5D=2");
});

test("YAML output keeps anchors for repeated objects and matches js-yaml without them", () => {
  const shared = { x: 1 };
  assert.match(stringifyValue({ a: shared, b: shared }, "yaml"), /&ref_0/);
  const value = { list: [{ a: 1 }, { a: 1 }], when: new Date(0) };
  assert.equal(stringifyValue(value, "yaml"), yaml.dump(value));
});

test("large MessagePack output does not overflow the call stack", () => {
  const value = Array.from({ length: 50_000 }, (_, i) => ({ i }));
  assert.deepEqual(parseText(stringifyValue(value, "msgpack"), "msgpack"), value);
});

test("JWT input uses decodeJwt", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
  const outcome = (fn: () => unknown) => {
    try {
      return { value: fn() };
    } catch (error) {
      return { error: String(error) };
    }
  };
  assert.deepEqual(outcome(() => parseText(token, "jwt")), outcome(() => decodeJwt(token)));
});

test("invalid input throws", () => {
  assert.throws(() => parseText("{bad", "json"));
  assert.throws(() => parseText("a = ", "toml"));
  assert.throws(() => parseText('{"a":1}\nnope', "jsonl"));
});
