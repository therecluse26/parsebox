/**
 * Format → CodeMirror highlighting and folding. Every language loads lazily
 * with `import()` the first time its format shows, so the entry chunk carries
 * none of them.
 */
import type { Extension } from "@codemirror/state";
import type { StreamParser } from "@codemirror/language";
import { indentFold, sectionFold, type FoldRule } from "./folds.ts";

export type Highlighter =
  | "json"
  | "xml"
  | "yaml"
  | "typescript"
  | "legacy-json"
  | "toml"
  | "properties"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "kotlin"
  | "swift"
  | "protobuf"
  | "python";

/**
 * "tree": the language's own syntax tree folds (JSON, XML, YAML, TypeScript).
 * "indent" and "section": the rules in folds.ts.
 */
export type Folding = "tree" | "indent" | "section" | null;

export interface Syntax {
  highlighter: Highlighter;
  folding: Folding;
}

/** Formats with highlighting. Every other format (text, csv, tsv, querystring, the encodings) shows plain text. */
export const SYNTAX: Record<string, Syntax> = {
  json: { highlighter: "json", folding: "tree" },
  jsonschema: { highlighter: "json", folding: "tree" },
  json5: { highlighter: "legacy-json", folding: "indent" },
  // One record per line, so there is nothing to fold
  jsonl: { highlighter: "legacy-json", folding: null },
  xml: { highlighter: "xml", folding: "tree" },
  yaml: { highlighter: "yaml", folding: "tree" },
  toon: { highlighter: "yaml", folding: "indent" },
  toml: { highlighter: "toml", folding: "section" },
  ini: { highlighter: "properties", folding: "section" },
  dotenv: { highlighter: "properties", folding: null },
  typescript: { highlighter: "typescript", folding: "tree" },
  zod: { highlighter: "typescript", folding: "tree" },
  // The generated types are indented, so indentation folds them
  go: { highlighter: "go", folding: "indent" },
  rust: { highlighter: "rust", folding: "indent" },
  java: { highlighter: "java", folding: "indent" },
  csharp: { highlighter: "csharp", folding: "indent" },
  kotlin: { highlighter: "kotlin", folding: "indent" },
  swift: { highlighter: "swift", folding: "indent" },
  protobuf: { highlighter: "protobuf", folding: "indent" },
  python: { highlighter: "python", folding: "indent" },
};

export function syntaxFor(format: string | null): Syntax | null {
  return (format && SYNTAX[format]) || null;
}

const stream = async (load: () => Promise<StreamParser<unknown>>): Promise<Extension> => {
  const { StreamLanguage } = await import("@codemirror/language");
  return StreamLanguage.define(await load());
};

const HIGHLIGHTERS: Record<Highlighter, () => Promise<Extension>> = {
  json: async () => (await import("@codemirror/lang-json")).json(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  "legacy-json": () => stream(async () => (await import("@codemirror/legacy-modes/mode/javascript")).json),
  toml: () => stream(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml),
  properties: () => stream(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties),
  go: () => stream(async () => (await import("@codemirror/legacy-modes/mode/go")).go),
  rust: () => stream(async () => (await import("@codemirror/legacy-modes/mode/rust")).rust),
  java: () => stream(async () => (await import("@codemirror/legacy-modes/mode/clike")).java),
  csharp: () => stream(async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp),
  kotlin: () => stream(async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin),
  swift: () => stream(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift),
  protobuf: () => stream(async () => (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf),
  python: () => stream(async () => (await import("@codemirror/legacy-modes/mode/python")).python),
};

const FOLD_RULES: Record<"indent" | "section", FoldRule> = { indent: indentFold, section: sectionFold };

const loaded = new Map<string, Promise<Extension>>();

/** The highlighting and folding extensions for a format; an empty list for plain text */
export function loadSyntax(format: string | null): Promise<Extension> {
  const syntax = syntaxFor(format);
  if (!syntax) return Promise.resolve([]);
  const key = format as string;
  let extension = loaded.get(key);
  if (!extension) {
    extension = (async () => {
      const language = await HIGHLIGHTERS[syntax.highlighter]();
      if (syntax.folding !== "indent" && syntax.folding !== "section") return language;
      const { foldService } = await import("@codemirror/language");
      return [language, foldService.of(FOLD_RULES[syntax.folding])];
    })();
    loaded.set(key, extension);
  }
  return extension;
}
