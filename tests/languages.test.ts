import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOptions } from "../src/config/formats.ts";
import { SYNTAX, syntaxFor } from "../src/lib/editor/languages.ts";

const values = (group: string) => formatOptions.filter((option) => option.group === group).map((option) => option.value);

test("every syntax entry is a known format", () => {
  for (const format of Object.keys(SYNTAX)) {
    assert.ok(formatOptions.some((option) => option.value === format), format);
  }
});

test("every type format has highlighting and folding", () => {
  for (const format of values("types")) {
    const syntax = syntaxFor(format);
    assert.ok(syntax, `${format} has highlighting`);
    assert.ok(syntax.folding, `${format} folds`);
  }
});

test("the nested data formats fold; the flat ones do not", () => {
  for (const format of ["json", "json5", "xml", "yaml", "toon", "toml", "ini"]) {
    assert.ok(syntaxFor(format)?.folding, `${format} folds`);
  }
  for (const format of ["jsonl", "dotenv"]) {
    assert.ok(syntaxFor(format), `${format} has highlighting`);
    assert.equal(syntaxFor(format)?.folding, null, `${format} does not fold`);
  }
});

test("plain text, tables, query strings, encodings and auto mode show plain text", () => {
  for (const format of ["auto", "text", "csv", "tsv", "querystring", ...values("encoding")]) {
    assert.equal(syntaxFor(format), null, format);
  }
  assert.equal(syntaxFor(null), null);
});
