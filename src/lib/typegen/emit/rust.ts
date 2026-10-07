import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { safeStart, snakeCase, uniqueIdents } from "../names.ts";

const KEYWORDS = new Set([
  "abstract", "as", "async", "await", "become", "box", "break", "const", "continue", "do", "dyn", "else", "enum", "extern",
  "false", "final", "fn", "for", "gen", "if", "impl", "in", "let", "loop", "macro", "match", "mod", "move", "mut",
  "override", "priv", "pub", "ref", "return", "static", "struct", "trait", "true", "try", "type", "typeof", "unsafe",
  "unsized", "use", "virtual", "where", "while", "yield",
]);
/** Keywords that cannot be raw identifiers */
const NOT_RAW = new Set(["crate", "self", "super", "Self"]);

function fieldIdent(key: string): string {
  const ident = safeStart(snakeCase(key), "field", "_");
  if (NOT_RAW.has(ident)) return `${ident}_`;
  return KEYWORDS.has(ident) ? `r#${ident}` : ident;
}

/** The name serde's rename_all = "camelCase" gives a field (same steps as serde) */
function serdeCamel(ident: string): string {
  const pascal = ident
    .replace(/^r#/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function rustType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "null":
    case "union":
      return "serde_json::Value";
    case "bool":
      base = "bool";
      break;
    case "int":
      base = "i64";
      break;
    case "float":
      base = "f64";
      break;
    case "string":
      base = "String";
      break;
    case "map":
      base = `HashMap<String, ${rustType(type.items!)}>`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array":
      base = `Vec<${rustType(type.items!)}>`;
      break;
  }
  return type.nullable ? `Option<${base}>` : base;
}

export function emitRust(model: Model): string {
  const blocks: string[] = [];
  const usesMap = modelUses(model, (type) => type.kind === "map");
  blocks.push(`use serde::{Deserialize, Serialize};${usesMap ? "\nuse std::collections::HashMap;" : ""}`);
  if (model.root.kind !== "object") blocks.push(`pub type Root = ${rustType(model.root)};`);

  for (const def of model.defsTopDown) {
    const idents = uniqueIdents(def.fields.map((field) => field.key), fieldIdent);
    const plain = idents.map((ident) => ident.replace(/^r#/, ""));
    // camelCase keys get rename_all, as serde users write it; other keys get a rename each
    const camel = def.fields.some((field, i) => field.key !== plain[i] && serdeCamel(idents[i]) === field.key);
    const lines = def.fields.map((field, i) => {
      const serdeName = camel ? serdeCamel(idents[i]) : plain[i];
      const attrs = serdeName === field.key ? "" : `    #[serde(rename = ${JSON.stringify(field.key)})]\n`;
      const type = rustType(field.type);
      const optionalType = field.optional && !type.startsWith("Option<") ? `Option<${type}>` : type;
      return `${attrs}    pub ${idents[i]}: ${optionalType},`;
    });
    const header = `#[derive(Debug, Clone, Serialize, Deserialize)]\n${camel ? '#[serde(rename_all = "camelCase")]\n' : ""}`;
    blocks.push(`${header}pub struct ${def.name} {\n${lines.join("\n")}\n}`);
  }
  return blocks.join("\n\n") + "\n";
}
