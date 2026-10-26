/**
 * Match counting for the find bar. Plain functions over EditorState, so the
 * tests run them without a DOM; findPanel.ts shows the result.
 */
import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

export interface Matches {
  /** The first matches in document order, at most the limit */
  ranges: { from: number; to: number }[];
  /** True when the text holds more matches than the limit */
  more: boolean;
}

/** The matches of a valid query, up to `limit` of them, so a common term in a large text stays cheap */
export function findMatches(state: EditorState, query: SearchQuery, limit: number): Matches {
  const ranges: { from: number; to: number }[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (ranges.length === limit) return { ranges, more: true };
    ranges.push({ from: next.value.from, to: next.value.to });
  }
  return { ranges, more: false };
}

/** "3 of 17" when the selection is the third match, "17 matches" when it is none of them, "no results" */
export function matchLabel(matches: Matches, selection: { from: number; to: number }): string {
  const { ranges, more } = matches;
  if (ranges.length === 0) return "no results";
  const total = more ? `${ranges.length}+` : String(ranges.length);
  const index = ranges.findIndex((range) => range.from === selection.from && range.to === selection.to);
  if (index >= 0) return `${index + 1} of ${total}`;
  return ranges.length === 1 && !more ? "1 match" : `${total} matches`;
}
