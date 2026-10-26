import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { findMatches, matchLabel } from "../src/lib/editor/find.ts";

const state = (doc: string) => EditorState.create({ doc });

test("findMatches lists every match in document order", () => {
  const matches = findMatches(state('{"id": 1, "ID": 2, "name": "id"}'), new SearchQuery({ search: "id" }), 100);
  assert.deepEqual(matches, {
    ranges: [
      { from: 2, to: 4 },
      { from: 11, to: 13 },
      { from: 28, to: 30 },
    ],
    more: false,
  });
});

test("findMatches follows the case and regex settings", () => {
  const doc = state('{"id": 1, "ID": 2, "uid": 3}');
  assert.equal(findMatches(doc, new SearchQuery({ search: "id", caseSensitive: true }), 100).ranges.length, 2);
  assert.equal(findMatches(doc, new SearchQuery({ search: "\\bid\\b", regexp: true }), 100).ranges.length, 2);
  assert.equal(findMatches(doc, new SearchQuery({ search: '"\\w+"', regexp: true }), 100).ranges.length, 3);
});

test("findMatches stops at the limit and says there are more", () => {
  const matches = findMatches(state("a".repeat(50)), new SearchQuery({ search: "a" }), 10);
  assert.equal(matches.ranges.length, 10);
  assert.equal(matches.more, true);
  assert.equal(findMatches(state("a".repeat(10)), new SearchQuery({ search: "a" }), 10).more, false);
});

test("matchLabel numbers the match the selection covers", () => {
  const matches = { ranges: [{ from: 0, to: 2 }, { from: 5, to: 7 }, { from: 9, to: 11 }], more: false };
  assert.equal(matchLabel(matches, { from: 5, to: 7 }), "2 of 3");
  assert.equal(matchLabel(matches, { from: 5, to: 5 }), "3 matches");
  assert.equal(matchLabel({ ranges: [{ from: 0, to: 2 }], more: false }, { from: 3, to: 3 }), "1 match");
  assert.equal(matchLabel({ ranges: [], more: false }, { from: 0, to: 0 }), "no results");
});

test("matchLabel marks a count cut at the limit", () => {
  const matches = { ranges: [{ from: 0, to: 1 }, { from: 1, to: 2 }], more: true };
  assert.equal(matchLabel(matches, { from: 1, to: 2 }), "2 of 2+");
  assert.equal(matchLabel(matches, { from: 5, to: 6 }), "2+ matches");
  assert.equal(matchLabel({ ranges: [{ from: 0, to: 1 }], more: true }, { from: 5, to: 6 }), "1+ matches");
});
