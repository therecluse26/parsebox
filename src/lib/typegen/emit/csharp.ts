import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { pascalCase, safeStart, uniqueIdents } from "../names.ts";

function csType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "null":
    case "union":
      base = "object";
      break;
    case "bool":
      base = "bool";
      break;
    case "int":
      base = type.big ? "long" : "int";
      break;
    case "float":
      base = "double";
      break;
    case "string":
      base = type.date ? "DateTimeOffset" : "string";
      break;
    case "map":
      base = `Dictionary<string, ${csType(type.items!)}>`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array":
      base = `List<${csType(type.items!)}>`;
      break;
  }
  return type.nullable || type.kind === "null" ? `${base}?` : base;
}

/** System.Text.Json (.NET 7+): `required` marks keys every object had; `?` marks keys that can be null or missing. */
export function emitCSharp(model: Model): string {
  const usings = ["System.Collections.Generic", "System.Text.Json.Serialization"];
  if (modelUses(model, (type) => type.kind === "string" && !!type.date)) usings.unshift("System");
  const blocks = [usings.map((using) => `using ${using};`).join("\n")];
  if (model.root.kind !== "object") blocks.push(`// Root: ${csType(model.root)}`);

  for (const def of model.defsTopDown) {
    // A member cannot have the name of its class
    const idents = uniqueIdents(def.fields.map((field) => field.key), (key) => safeStart(pascalCase(key), "Field", "_"), [def.name]);
    const props = def.fields.map((field, i) => {
      let type = csType(field.type);
      if (field.optional && !type.endsWith("?")) type += "?";
      const required = field.optional ? "" : "required ";
      return `    [JsonPropertyName(${JSON.stringify(field.key)})]\n    public ${required}${type} ${idents[i]} { get; set; }`;
    });
    blocks.push(`public class ${def.name}\n{\n${props.join("\n\n")}\n}`);
  }
  return blocks.join("\n\n") + "\n";
}
