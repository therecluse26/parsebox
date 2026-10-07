import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { camelCase, safeStart, uniqueIdents } from "../names.ts";

const KEYWORDS = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is", "null", "object",
  "package", "return", "super", "this", "throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while",
]);

const fieldIdent = (key: string) => {
  const ident = safeStart(camelCase(key), "field", "_");
  return KEYWORDS.has(ident) ? `\`${ident}\`` : ident;
};

/** A Kotlin string literal: JSON escapes plus `$`, which starts a template */
const kotlinString = (text: string) => JSON.stringify(text).replace(/\$/g, "\\$");

function ktType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "union":
      base = "JsonElement";
      break;
    case "null":
      return "JsonElement?";
    case "bool":
      base = "Boolean";
      break;
    case "int":
      base = type.big ? "Long" : "Int";
      break;
    case "float":
      base = "Double";
      break;
    case "string":
      base = "String";
      break;
    case "map":
      base = `Map<String, ${ktType(type.items!)}>`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array":
      base = `List<${ktType(type.items!)}>`;
      break;
  }
  return type.nullable ? `${base}?` : base;
}

/** kotlinx.serialization data classes */
export function emitKotlin(model: Model): string {
  const imports = ["kotlinx.serialization.Serializable"];
  const blocks: string[] = [];
  if (model.root.kind !== "object") blocks.push(`typealias Root = ${ktType(model.root)}`);

  for (const def of model.defsTopDown) {
    const idents = uniqueIdents(def.fields.map((field) => field.key), fieldIdent);
    const params = def.fields.map((field, i) => {
      const plain = idents[i].replace(/`/g, "");
      const serialName = plain === field.key ? "" : `@SerialName(${kotlinString(field.key)}) `;
      let type = ktType(field.type);
      // Missing keys need a default
      if (field.optional && !type.endsWith("?")) type += "?";
      return `    ${serialName}val ${idents[i]}: ${type}${field.optional ? " = null" : ""},`;
    });
    blocks.push(`@Serializable\ndata class ${def.name}(\n${params.join("\n")}\n)`);
  }

  const output = blocks.join("\n\n");
  if (output.includes("@SerialName(")) imports.unshift("kotlinx.serialization.SerialName");
  if (modelUses(model, (type) => type.kind === "any" || type.kind === "null" || type.kind === "union")) {
    imports.push("kotlinx.serialization.json.JsonElement");
  }
  return `${imports.map((name) => `import ${name}`).join("\n")}\n\n${output}\n`;
}
