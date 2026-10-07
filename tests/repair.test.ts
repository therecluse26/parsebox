import { test } from "node:test";
import assert from "node:assert/strict";
import JSON5 from "json5";
import yaml from "js-yaml";
import TOML from "@ltd/j-toml";
import { XMLValidator } from "fast-xml-parser";
import { decode as toonDecode } from "@toon-format/toon";
import Papa from "papaparse";
import { tryRepair, describeParseError } from "../src/lib/repair.ts";
import { LIMITS } from "../src/config/limits.ts";

// Throw with the real parser so the tests see the real error shapes
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the parser to throw");
}

function repaired(text: string) {
  const result = tryRepair(text);
  assert.ok(result, `expected ${JSON.stringify(text)} to repair`);
  return result;
}

// ---------------------------------------------------------------------------
// tryRepair

test("repair: trailing commas", () => {
  const { value, info } = repaired('{"a": 1, "b": [1, 2, 3,], "c": {"d": 4,},}');
  assert.deepEqual(value, { a: 1, b: [1, 2, 3], c: { d: 4 } });
  assert.equal(info.format, "json");
  assert.deepEqual(info.fixes, ["trailing commas removed (3)"]);
  assert.equal(info.fixCount, 3);
});

test("repair: comments", () => {
  const { value, info } = repaired('{\n  // the name\n  "name": "x", /* inline */ "n": 1\n}');
  assert.deepEqual(value, { name: "x", n: 1 });
  assert.deepEqual(info.fixes, ["comments removed (2)"]);
});

test("repair: single quotes", () => {
  const { value, info } = repaired("{'a': 'it\\'s', \"b\": 'x'}");
  assert.deepEqual(value, { a: "it's", b: "x" });
  assert.deepEqual(info.fixes, ["single quotes → double quotes (3)"]);
});

test("repair: unquoted keys", () => {
  const { value, info } = repaired('{name: "Ada", age: 36, $id: 1}');
  assert.deepEqual(value, { name: "Ada", age: 36, $id: 1 });
  assert.deepEqual(info.fixes, ["unquoted keys quoted (3)"]);
});

test("repair: python dict print", () => {
  const { value, info } = repaired("{'a': True, 'b': None, 'c': [False, 1.5], 'd': \"it's\"}");
  assert.deepEqual(value, { a: true, b: null, c: [false, 1.5], d: "it's" });
  assert.deepEqual(info.fixes, ["single quotes → double quotes (4)", "True/False/None → true/false/null (3)"]);
  assert.equal(info.fixCount, 7);
});

test("repair: js object literal", () => {
  const { value, info } = repaired("{\n  name: 'demo',\n  tags: ['a', 'b',],\n  extra: undefined, // unset\n}");
  assert.deepEqual(value, { name: "demo", tags: ["a", "b"], extra: null });
  assert.deepEqual(info.fixes, [
    "trailing commas removed (2)",
    "single quotes → double quotes (3)",
    "unquoted keys quoted (3)",
    "comments removed",
    "undefined → null",
  ]);
  assert.equal(info.fixCount, 10);
});

test("repair: truncated json", () => {
  const { value, info } = repaired('{"users": [{"id": 1, "tags": ["a", "b"');
  assert.deepEqual(value, { users: [{ id: 1, tags: ["a", "b"] }] });
  assert.deepEqual(info.fixes, ["missing closing brackets added (4)"]);
});

test("repair: truncated inside a string", () => {
  const { value, info } = repaired('{"a": [1, 2], "b": "hel');
  assert.deepEqual(value, { a: [1, 2], b: "hel" });
  assert.deepEqual(info.fixes, ["missing closing brackets added", "missing quotes added"]);
});

test("repair: json copied from a log line with escaped quotes", () => {
  const { value, info } = repaired('{\\"user\\": \\"ada\\", \\"note\\": \\"say \\\\\\"hi\\\\\\"\\", \\"n\\": 1}');
  assert.deepEqual(value, { user: "ada", note: 'say "hi"', n: 1 });
  assert.deepEqual(info.fixes, ["escaped quotes unescaped"]);
});

test("repair: escaped pretty json with literal \\n", () => {
  const { value } = repaired('{\\n  \\"a\\": [1, 2]\\n}');
  assert.deepEqual(value, { a: [1, 2] });
});

test("repair: jsonl with one broken line", () => {
  const { value, info } = repaired('{"id": 1}\n{"id": 2, "x": [1,],}\n{"id": 3}\n');
  assert.deepEqual(value, [{ id: 1 }, { id: 2, x: [1] }, { id: 3 }]);
  assert.deepEqual(info.fixes, ["trailing commas removed (2)"]);
});

test("repair: several root values alone are reported as wrapped", () => {
  const { value, info } = repaired('{"a": 1}\n{"a": 2}');
  assert.deepEqual(value, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(info.fixes, ["values wrapped in an array"]);
  assert.equal(info.fixCount, 1);
});

test("repair: concatenated values on one line", () => {
  assert.deepEqual(repaired('{"a": 1}{"b": 2}').value, [{ a: 1 }, { b: 2 }]);
});

test("repair: missing commas, extra brackets, wrappers", () => {
  assert.deepEqual(repaired('{"a": 1\n"b": 2}').info.fixes, ["missing commas added"]);
  assert.deepEqual(repaired("[1 2 3]").info.fixes, ["missing commas added (2)"]);
  assert.deepEqual(repaired('{"a": 1}}').info.fixes, ["extra closing brackets removed"]);
  assert.deepEqual(repaired('{"a": [1, 2}').info.fixes, ["missing closing brackets added"]);
  assert.deepEqual(repaired('callback({"a": 1});').value, { a: 1 });
  assert.deepEqual(repaired('{"n": NumberLong("2")}').info.fixes, ["function wrappers removed"]);
  assert.deepEqual(repaired('```json\n{"a": 1,}\n```').info.fixes, ["trailing commas removed", "code fences removed"]);
  assert.deepEqual(repaired("[1, 2, ...]").info.fixes, ["ellipses removed"]);
});

test("repair: the fix list is capped, the count is not", () => {
  const { info } = repaired("{a: 'x', b: True, c: undefined, d: NaN, e: [1,], // c\n f: “q”, g: 1 h: 2");
  assert.equal(info.fixes.length, LIMITS.repairFixesShown);
  assert.ok(info.fixCount > info.fixes.length);
  assert.equal(info.fixCount, 17);
});

// Bare words as values mean YAML, INI, TOML or plain text, not broken JSON
for (const text of [
  "[a, b]",
  "{ foo: bar }",
  "{name: Ada, langs: [en, fr]}",
  "[server]\nport = 80",
  "[[products]]\nname = 'x'",
  "[INFO] Server started",
  '{"d": 2020-01-01}',
  '{"n": 0x1F}',
  "hello world",
]) {
  test(`repair declines ${JSON.stringify(text)}`, () => {
    assert.equal(tryRepair(text), null);
  });
}

test("repair: null when jsonrepair cannot fix it", () => {
  assert.equal(tryRepair('{"a": 1, "b"}'), null);
  assert.equal(tryRepair('{# not a comment\n"a": 1}'), null);
  assert.equal(tryRepair(""), null);
  assert.equal(tryRepair("// only a comment"), null);
});

test("repair: null over the size cap", () => {
  const text = "[" + "1,".repeat(LIMITS.repairMaxChars / 2) + "]";
  assert.ok(text.length > LIMITS.repairMaxChars);
  assert.equal(tryRepair(text), null);
});

// ---------------------------------------------------------------------------
// describeParseError: JSON

test("json: trailing comma", () => {
  const text = '{\n  "a": 1,\n  "b": 2,\n}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.message, "expected double-quoted property name");
  assert.equal(info.line, 4);
  assert.equal(info.column, 1);
  assert.equal(info.hint, "remove the trailing comma");
});

test("json: single quotes", () => {
  const text = "{'a': 1}";
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.deepEqual([info.line, info.column, info.hint], [1, 2, "use double quotes"]);
});

test("json: unquoted key", () => {
  const text = '{"a": 1,\n b: 2}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.deepEqual([info.line, info.column, info.hint], [2, 2, "quote the key with double quotes"]);
});

test("json: comment", () => {
  const text = '{"a": 1 // note\n}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.hint, "remove the comment (json has no comments)");
});

test("json: missing comma and mismatched bracket", () => {
  let text = '{"a": 1 "b": 2}';
  assert.equal(describeParseError(thrown(() => JSON.parse(text)), text, "json").hint, "add the missing comma");
  text = "[1, 2}";
  assert.equal(describeParseError(thrown(() => JSON.parse(text)), text, "json").hint, "mismatched bracket: expected ]");
});

test("json: unexpected end of input", () => {
  const text = '{"a": [1, 2';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.line, 1);
  assert.equal(info.hint, "missing closing } or ]");
  const empty = describeParseError(thrown(() => JSON.parse('{"a":')), '{"a":', "json");
  assert.equal(empty.message, "unexpected end of JSON input");
  assert.equal(empty.hint, "missing closing } or ]");
});

test("json: unterminated string and control characters", () => {
  let text = '{"a": "b';
  assert.equal(describeParseError(thrown(() => JSON.parse(text)), text, "json").hint, "missing closing quote");
  text = '{"a": "line\nbreak"}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.hint, "escape line breaks and tabs in strings (\\n, \\t)");
});

test("json: python constant in a short text (V8 gives no position)", () => {
  const text = '{"a": True}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.message, "unexpected token 'T'");
  assert.deepEqual([info.line, info.column, info.hint], [1, 7, "use true, false or null"]);
});

test("json: bad token in a long text is placed from V8's snippet", () => {
  const rows = Array.from({ length: 50 }, (_, i) => `  {"id": ${i}, "ok": true},`);
  rows[37] = '  {"id": 37, "ok": undefined},';
  const text = "[\n" + rows.join("\n") + '\n  {"id": 99}\n]';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.equal(info.message, "unexpected token 'u'");
  assert.deepEqual([info.line, info.column, info.hint], [39, 20, "use null"]);
});

test("json: repeated bad token in a short text picks the one that failed", () => {
  const text = "[1,,2]";
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.deepEqual([info.column, info.hint], [4, "remove the extra comma"]);
});

test("json: extra values after the root", () => {
  const text = '{"a": 1}\n{"a": 2}';
  const info = describeParseError(thrown(() => JSON.parse(text)), text, "json");
  assert.deepEqual([info.line, info.column], [2, 1]);
  assert.equal(info.hint, "more than one value: wrap them in [ ] or use jsonl");
});

test("json: Firefox message", () => {
  const text = '{\n  "a": 1,\n}';
  const error = new SyntaxError("JSON.parse: expected double-quoted property name at line 3 column 1 of the JSON data");
  const info = describeParseError(error, text, "json");
  assert.deepEqual(info, { message: "expected double-quoted property name", line: 3, column: 1, hint: "remove the trailing comma" });
});

test("json: Safari message has no position", () => {
  const error = new SyntaxError("JSON Parse error: Single quotes (') are not allowed in JSON");
  const info = describeParseError(error, "{'a': 1}", "json");
  assert.equal(info.message, "single quotes (') are not allowed in JSON");
  assert.equal(info.line, undefined);
  assert.equal(info.hint, "use double quotes");
  const eof = describeParseError(new SyntaxError("JSON Parse error: Unexpected EOF"), '{"a":', "json");
  assert.equal(eof.hint, "missing closing } or ]");
});

test("json: old V8 message with a position only", () => {
  const text = '{\n"a": 1,\n}';
  const info = describeParseError(new SyntaxError("Unexpected token } in JSON at position 10"), text, "json");
  assert.deepEqual(info, { message: "unexpected token }", line: 3, column: 1, hint: "remove the trailing comma" });
});

// ---------------------------------------------------------------------------
// describeParseError: other formats

test("jsonl: finds the failing line", () => {
  const text = '{"id": 1}\n\n{"id": 2}\n{"id": 3,}\n{"id": 4}';
  const error = thrown(() =>
    text
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  );
  const info = describeParseError(error, text, "jsonl");
  assert.deepEqual(info, { message: "expected double-quoted property name", line: 4, column: 10, hint: "remove the trailing comma" });
});

test("json5: lineNumber and columnNumber", () => {
  const text = "{a: 1,\n b: 2,,\n}";
  const info = describeParseError(thrown(() => JSON5.parse(text)), text, "json5");
  assert.deepEqual(info, { message: "invalid character ','", line: 2, column: 7, hint: "remove the extra comma" });
});

test("json5: end of input", () => {
  const text = "{a: [1,";
  const info = describeParseError(thrown(() => JSON5.parse(text)), text, "json5");
  assert.equal(info.message, "invalid end of input");
  assert.equal(info.hint, "missing closing } or ]");
});

test("yaml: mark is 0-based, message drops the snippet", () => {
  const text = "a: 1\n b: 2";
  const info = describeParseError(thrown(() => yaml.load(text)), text, "yaml");
  assert.deepEqual(info, { message: "bad indentation of a mapping entry", line: 2, column: 3, hint: "check the indentation" });
  const tabs = "a:\n\t- x";
  assert.equal(describeParseError(thrown(() => yaml.load(tabs)), tabs, "yaml").hint, "indent with spaces, not tabs");
});

test("toml: line from the message", () => {
  const text = 'a = 1\nb = "x';
  const info = describeParseError(thrown(() => TOML.parse(text, { joiner: "\n", bigint: false })), text, "toml");
  assert.deepEqual(info, { message: "bad basic string", line: 2, hint: "check the string quotes" });
  const dup = "a = 1\na = 2";
  const dupInfo = describeParseError(thrown(() => TOML.parse(dup, { joiner: "\n", bigint: false })), dup, "toml");
  assert.deepEqual([dupInfo.line, dupInfo.hint], [2, "remove the duplicate key"]);
});

test("toon: line from the message", () => {
  const text = "a:\n   b: 1";
  const info = describeParseError(thrown(() => toonDecode(text)), text, "toon");
  assert.equal(info.line, 2);
  assert.equal(info.hint, "check the indentation");
  assert.ok(!info.message.startsWith("Line"));
  const count = "tags[3]: a,b";
  assert.equal(describeParseError(thrown(() => toonDecode(count)), count, "toon").hint, "the [n] count does not match the items");
});

test("xml: XMLValidator result", () => {
  const text = "<a>\n  <b></a>";
  const result = XMLValidator.validate(text);
  assert.notEqual(result, true);
  const info = describeParseError(result, text, "xml");
  assert.equal(info.line, 2);
  assert.equal(info.column, 6);
  assert.equal(info.hint, "closing tags must match their opening tags");
});

test("csv: papaparse errors", () => {
  const text = 'a,b\n1,2\n"x,3';
  const { errors } = Papa.parse(text, { header: true });
  const info = describeParseError(errors, text, "csv");
  assert.equal(info.message, "quoted field unterminated");
  assert.equal(info.line, 3);
  assert.equal(info.hint, "missing closing quote");
});

test("plain errors and non-errors", () => {
  assert.deepEqual(describeParseError(new Error("Invalid base64"), "x", "base64"), { message: "invalid base64", hint: undefined });
  assert.equal(describeParseError("boom", "x", "hex").message, "boom");
  assert.equal(describeParseError(new Error(""), "x", "hex").message, "invalid hex");
  const long = describeParseError(new Error("x".repeat(5000)), "x", "text");
  assert.ok(long.message.length <= 200);
});
