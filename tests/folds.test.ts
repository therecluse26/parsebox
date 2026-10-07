import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import { indentFold, sectionFold, type FoldRule } from "../src/lib/editor/folds.ts";

const testData = path.join(import.meta.dirname, "..", "test-data");

/** The fold under a 1-based line, as the first and last hidden line numbers, or null */
function foldAt(rule: FoldRule, doc: string, lineNumber: number): [number, number] | null {
  const state = EditorState.create({ doc });
  const line = state.doc.line(lineNumber);
  const range = rule(state, line.from, line.to);
  if (!range) return null;
  assert.equal(range.from, line.to, "a fold starts at the end of its line");
  return [state.doc.lineAt(range.from).number + 1, state.doc.lineAt(range.to).number];
}

test("indentFold folds the deeper lines under a line", () => {
  const doc = "a:\n  b: 1\n  c:\n    d: 2\ne: 3";
  assert.deepEqual(foldAt(indentFold, doc, 1), [2, 4]);
  assert.deepEqual(foldAt(indentFold, doc, 3), [4, 4]);
  assert.equal(foldAt(indentFold, doc, 2), null);
  assert.equal(foldAt(indentFold, doc, 5), null);
});

test("indentFold keeps blank lines inside a block and leaves trailing ones out", () => {
  const doc = "a:\n  b: 1\n\n  c: 2\n\n\nd: 3";
  assert.deepEqual(foldAt(indentFold, doc, 1), [2, 4]);
  assert.equal(foldAt(indentFold, doc, 3), null);
});

test("indentFold counts a tab to the next tab stop", () => {
  assert.deepEqual(foldAt(indentFold, "type A struct {\n\tB int\n}", 1), [2, 2]);
});

test("indentFold folds a brace block and leaves its closing brace visible", () => {
  const doc = "{\n  app: {\n    name: 'x',\n  },\n}";
  assert.deepEqual(foldAt(indentFold, doc, 2), [3, 3]);
  assert.deepEqual(foldAt(indentFold, doc, 1), [2, 4]);
});

test("indentFold folds the blocks of test-data/toon/config.toon", () => {
  const doc = fs.readFileSync(path.join(testData, "toon", "config.toon"), "utf8");
  assert.deepEqual(foldAt(indentFold, doc, 1), [2, 4]);
  assert.deepEqual(foldAt(indentFold, doc, 5), [6, 8]);
});

test("sectionFold folds a section to the line before the next section", () => {
  const doc = fs.readFileSync(path.join(testData, "toml", "cargo.toml"), "utf8");
  assert.deepEqual(foldAt(sectionFold, doc, 1), [2, 7]);
  assert.deepEqual(foldAt(sectionFold, doc, 9), [10, 13]);
  assert.equal(foldAt(sectionFold, doc, 2), null);
});

test("sectionFold folds INI sections and skips comment lines above them", () => {
  const doc = fs.readFileSync(path.join(testData, "ini", "config.ini"), "utf8");
  assert.equal(foldAt(sectionFold, doc, 1), null);
  assert.deepEqual(foldAt(sectionFold, doc, 2), [3, 5]);
  assert.deepEqual(foldAt(sectionFold, doc, 7), [8, 9]);
});

test("sectionFold folds [[array]] tables and ignores array lines inside a table", () => {
  const doc = '[[items]]\nid = 1\ngrid = [\n  [1, 2],\n  [3, 4],\n]\n\n[[items]]\nid = 2';
  assert.deepEqual(foldAt(sectionFold, doc, 1), [2, 6]);
  assert.equal(foldAt(sectionFold, doc, 4), null);
  assert.deepEqual(foldAt(sectionFold, doc, 8), [9, 9]);
});

test("sectionFold does not fold an empty section", () => {
  assert.equal(foldAt(sectionFold, "[a]\n\n[b]\nx = 1", 1), null);
});
