import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { camelCase, safeStart, uniqueIdents } from "../names.ts";

const KEYWORDS = new Set([
  "_", "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default",
  "do", "double", "else", "enum", "extends", "false", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new", "null", "package", "private", "protected",
  "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "true", "try", "void", "volatile", "while",
]);

const fieldIdent = (key: string) => {
  const ident = safeStart(camelCase(key), "field", "_");
  return KEYWORDS.has(ident) ? `${ident}_` : ident;
};

const BOXED: Record<string, string> = { boolean: "Boolean", int: "Integer", long: "Long", double: "Double" };

/** `boxed`: the type sits in a generic or can be null, so primitives are boxed */
function javaType(type: TypeRef, boxed: boolean): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "null":
    case "union":
      return "Object";
    case "bool":
      base = "boolean";
      break;
    case "int":
      base = type.big ? "long" : "int";
      break;
    case "float":
      base = "double";
      break;
    case "string":
      return "String";
    case "map":
      return `Map<String, ${javaType(type.items!, true)}>`;
    case "object":
      return type.def!.name;
    case "array":
      return `List<${javaType(type.items!, true)}>`;
  }
  return boxed || type.nullable ? BOXED[base] : base;
}

/** Records (Java 16+) for Jackson 2.12+ */
export function emitJava(model: Model): string {
  const blocks: string[] = [];
  if (model.root.kind !== "object") blocks.push(`// Root: ${javaType(model.root, true)}`);

  model.defsTopDown.forEach((def, index) => {
    const idents = uniqueIdents(def.fields.map((field) => field.key), fieldIdent);
    const params = def.fields.map((field, i) => {
      const annotation = idents[i] === field.key ? "" : `@JsonProperty(${JSON.stringify(field.key)}) `;
      return `    ${annotation}${javaType(field.type, field.optional)} ${idents[i]}`;
    });
    // One public type per file; the others sit beside it
    const visibility = index === 0 ? "public " : "";
    blocks.push(`${visibility}record ${def.name}(\n${params.join(",\n")}\n) {}`);
  });

  const output = blocks.join("\n\n");
  const imports: string[] = [];
  if (output.includes("@JsonProperty(")) imports.push("com.fasterxml.jackson.annotation.JsonProperty");
  if (modelUses(model, (type) => type.kind === "array")) imports.push("java.util.List");
  if (modelUses(model, (type) => type.kind === "map")) imports.push("java.util.Map");
  return imports.length ? `${imports.map((name) => `import ${name};`).join("\n")}\n\n${output}\n` : `${output}\n`;
}
