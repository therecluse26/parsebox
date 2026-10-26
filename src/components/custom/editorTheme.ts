/**
 * The look of both panes: the terminal palette from index.css, text-sm with
 * leading-[1.5] (21px lines), and one colour per kind of token.
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const KEY = "#82aaff";
const STRING = "#c3e88d";
const NUMBER = "#ff8a5c";
const PUNCTUATION = "#8e8d86";
const KEYWORD = "#c792ea";
const COMMENT = "#6e6d67";

export const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "hsl(var(--foreground))",
      backgroundColor: "transparent",
      fontSize: "0.875rem",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.5",
      overflow: "auto",
    },
    // py-3, and pl-1 pr-3 on each line
    ".cm-content": {
      padding: "0.75rem 0",
      caretColor: "hsl(var(--primary))",
    },
    ".cm-line": { padding: "0 0.75rem 0 0.25rem" },
    ".cm-placeholder": { color: "hsl(var(--dim))" },
    // Numbers right-aligned after pl-3.5, then the fold markers in a pr-3 wide column.
    // CodeMirror lines the gutter up with the content padding itself.
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "hsl(var(--gutter))",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 0 0 0.875rem",
      minWidth: "0",
    },
    ".cm-errorLineNumber": {
      margin: "0 -0.25rem",
      padding: "0 0.25rem",
      borderRadius: "calc(var(--radius) - 4px)",
      backgroundColor: "hsl(var(--destructive) / 0.15)",
      color: "hsl(var(--destructive))",
    },
    // The fold marker column is as wide as pr-3
    ".cm-foldGutter .cm-gutterElement": {
      width: "0.75rem",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
    },
    ".cm-foldMarker": {
      display: "block",
      width: "0.5rem",
      height: "0.5rem",
      opacity: "0",
      transition: "opacity 120ms",
    },
    // Open markers show while the pointer is over the gutter; a folded marker always shows
    ".cm-gutters:hover .cm-foldMarker, .cm-foldMarker[data-folded]": { opacity: "1" },
    ".cm-foldGutter .cm-gutterElement:hover .cm-foldMarker": { color: "hsl(var(--primary))" },
    ".cm-foldPlaceholder": {
      margin: "0 0.25rem",
      padding: "0 0.375rem",
      border: "1px solid hsl(var(--input))",
      borderRadius: "calc(var(--radius) - 4px)",
      backgroundColor: "hsl(var(--popover))",
      color: "hsl(var(--muted-foreground))",
    },
    ".cm-foldPlaceholder:hover": { color: "hsl(var(--primary))" },
    // The find bar (findPanel.ts): a toolbar row like the pane header above it
    ".cm-panels": { backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" },
    ".cm-panels-top": { borderBottom: "1px solid hsl(var(--border))" },
    ".cm-find": {
      display: "flex",
      alignItems: "center",
      gap: "0.25rem",
      padding: "0.375rem 0.625rem 0.375rem 0.875rem",
      fontSize: "0.75rem",
    },
    ".cm-find input": {
      flex: "1",
      minWidth: "0",
      height: "1.75rem",
      padding: "0 0.5rem",
      border: "1px solid hsl(var(--input))",
      borderRadius: "calc(var(--radius) - 2px)",
      backgroundColor: "hsl(var(--popover))",
      color: "inherit",
      font: "inherit",
      outline: "none",
    },
    ".cm-find input:focus": { borderColor: "hsl(var(--primary) / 0.6)" },
    ".cm-find input::placeholder": { color: "hsl(var(--dim))" },
    ".cm-findCount": { padding: "0 0.375rem", color: "hsl(var(--dim))", whiteSpace: "nowrap" },
    ".cm-findCount[data-error]": { color: "hsl(var(--destructive))" },
    ".cm-find button": {
      display: "inline-flex",
      flexShrink: "0",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "1.75rem",
      height: "1.75rem",
      padding: "0 0.25rem",
      border: "none",
      borderRadius: "calc(var(--radius) - 2px)",
      backgroundColor: "transparent",
      color: "hsl(var(--muted-foreground))",
      font: "inherit",
      cursor: "pointer",
    },
    ".cm-find button:hover": { backgroundColor: "hsl(var(--accent))", color: "hsl(var(--foreground))" },
    ".cm-find button[aria-pressed=true]": { backgroundColor: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" },
    ".cm-find button:focus-visible": { outline: "1px solid hsl(var(--ring))" },
    // Every match, and the selected one, which shows even while the focus is in the find bar
    ".cm-searchMatch": { backgroundColor: "hsl(var(--primary) / 0.2)", borderRadius: "2px" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "hsl(var(--primary) / 0.45)",
      outline: "1px solid hsl(var(--primary))",
    },
  },
  { dark: true }
);

const highlightStyle = HighlightStyle.define([
  // t.definition(t.variableName): keys in the INI and dotenv modes
  { tag: [t.propertyName, t.attributeName, t.tagName, t.labelName, t.definition(t.variableName)], color: KEY },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.typeName), t.className], color: KEY },
  // t.quote: values in the INI and dotenv modes
  { tag: [t.string, t.special(t.string), t.attributeValue, t.regexp, t.character, t.quote], color: STRING },
  { tag: [t.number, t.integer, t.float, t.standard(t.variableName)], color: NUMBER },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator, t.derefOperator], color: PUNCTUATION },
  {
    tag: [t.keyword, t.bool, t.null, t.atom, t.typeName, t.heading, t.meta, t.processingInstruction, t.angleBracket],
    color: KEYWORD,
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: COMMENT, fontStyle: "italic" },
]);

export const editorHighlighting = syntaxHighlighting(highlightStyle);
