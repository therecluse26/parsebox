import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import { LIMITS } from "../config/limits.ts";

// Only the languages ParseBox writes, so the worker stays small. "ini" also registers the "toml" alias.
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("ini", ini);

/** Output format → highlight.js language */
const FORMAT_LANGUAGES: Record<string, string> = {
  json: "json",
  json5: "json",
  jsonl: "json",
  xml: "xml",
  yaml: "yaml",
  toon: "yaml",
  toml: "toml",
  ini: "ini",
};

/**
 * Highlight another output format, for example a type output:
 * `registerHighlightLanguage("typescript", "typescript", typescript)` with
 * `import typescript from "highlight.js/lib/languages/typescript"`.
 * Pass no definition to reuse a registered language.
 */
export function registerHighlightLanguage(format: string, language: string, definition?: LanguageFn): void {
  if (definition) hljs.registerLanguage(language, definition);
  FORMAT_LANGUAGES[format] = language;
}

/** The highlight.js language for an output format, or null when the format has no highlighting. */
export function highlightLanguageFor(format: string): string | null {
  return FORMAT_LANGUAGES[format] ?? null;
}

/** highlight.js HTML for the output, or null when the format has no highlighting or the output is over the cap. */
export function highlightOutput(output: string, format: string): string | null {
  const language = highlightLanguageFor(format);
  if (!language || output === "" || output.length > LIMITS.highlightMaxChars) return null;
  try {
    return hljs.highlight(output, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
