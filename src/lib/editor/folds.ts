/**
 * Fold rules for the formats whose CodeMirror language has no fold
 * information of its own. Each rule takes a line and returns the range that
 * folds away under it, or null. They are plain functions over EditorState, so
 * the tests run them without a DOM; languages.ts wraps them in foldService.
 */
import type { EditorState } from "@codemirror/state";

export type FoldRule = (state: EditorState, lineStart: number, lineEnd: number) => { from: number; to: number } | null;

/** The indentation column of a line, or -1 for a blank line */
function indentOf(text: string, tabSize: number): number {
  let column = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char === 32) column++;
    else if (char === 9) column += tabSize - (column % tabSize);
    else return column;
  }
  return -1;
}

/**
 * A line folds the lines after it that are indented deeper. Blank lines inside
 * the block fold with it; blank lines at its end stay visible.
 * Most lines stop at the first check: the next line is not deeper.
 */
export const indentFold: FoldRule = (state, lineStart, lineEnd) => {
  const doc = state.doc;
  const first = doc.lineAt(lineStart);
  const indent = indentOf(first.text, state.tabSize);
  if (indent === -1) return null;
  let last = first.number;
  for (let n = first.number + 1; n <= doc.lines; n++) {
    const lineIndent = indentOf(doc.line(n).text, state.tabSize);
    if (lineIndent === -1) continue;
    if (lineIndent <= indent) break;
    last = n;
  }
  if (last === first.number) return null;
  return { from: lineEnd, to: doc.line(last).to };
};

// [name] or [[name]], then an optional comment; not a "[1, 2]," line inside a TOML array
const SECTION = /^\s*\[\[?[^[\]]+\]\]?\s*([#;].*)?$/;

/**
 * A [section] line (TOML tables, [[arrays]] and INI sections) folds the lines
 * up to the next section line. Blank lines before the next section stay visible.
 */
export const sectionFold: FoldRule = (state, lineStart, lineEnd) => {
  const doc = state.doc;
  const first = doc.lineAt(lineStart);
  if (!SECTION.test(first.text)) return null;
  let last = first.number;
  for (let n = first.number + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (SECTION.test(text)) break;
    if (/\S/.test(text)) last = n;
  }
  if (last === first.number) return null;
  return { from: lineEnd, to: doc.line(last).to };
};
