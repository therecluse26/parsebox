import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { detectFormat } from "../src/lib/detectFormat.ts";

const testData = path.join(import.meta.dirname, "..", "test-data");

// Every sample in test-data/<format>/ must be detected as <format>
for (const format of fs.readdirSync(testData).sort()) {
  const dir = path.join(testData, format);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    test(`test-data/${format}/${file} is ${format}`, () => {
      assert.equal(detectFormat(fs.readFileSync(path.join(dir, file), "utf8")), format);
    });
  }
}

// Short inputs that look like a format but are not, plus small real examples
const cases: [string, string][] = [
  ["", "text"],
  ["   \n  ", "text"],
  ["hello", "text"],
  ["cafe", "text"],
  ["deadbeef", "text"],
  ["Test", "text"],
  ["2026", "text"],
  ["42", "text"],
  ["Note: call me back after lunch", "text"],
  ["[INFO] Server started", "text"],
  ["<div><br></div>", "text"],
  ["50% off today", "text"],
  ["one, two\nthree", "text"],
  ['"just a string"', "json"],
  ['{"a":1}', "json"],
  ['{"a":1}\n{"a":2}', "jsonl"],
  ["{a: 1, // comment\n}", "json5"],
  ["<a><b>1</b></a>", "xml"],
  ["01001000 01101001", "binary"],
  ["48656c6c6f", "hex"],
  ["48 65 6c 6c 6f", "hex"],
  ["SGVsbG8sIHdvcmxkIQ==", "base64"],
  ["SGVsbG8sIHdvcmxkIQ==\n", "base64"],
  ["gaFhAQ==", "msgpack"],
  ["?a=1&b=2", "querystring"],
  ["q=hello+world", "querystring"],
  ["hello%20world", "uri"],
  ["https%3A%2F%2Fexample.com%2F%3Fq%3D1", "uri"],
  ["API_KEY=abc123", "dotenv"],
  ["export NODE_ENV=production\nPORT=3000", "dotenv"],
  ['name = "demo"\nport = 8080', "toml"],
  ["[section]\nkey=some value", "ini"],
  ["tags[2]: a,b", "toon"],
  ["name: Ada\nrole: admin", "yaml"],
  ["- one\n- two", "yaml"],
  ["a\tb\n1\t2", "tsv"],
  ["a,b\n1,2", "csv"],
  ["a;b\n1;2", "csv"],
];

for (const [input, expected] of cases) {
  test(`${JSON.stringify(input)} is ${expected}`, () => {
    assert.equal(detectFormat(input), expected);
  });
}
