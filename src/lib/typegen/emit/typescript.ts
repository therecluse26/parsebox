import type { Model, TypeRef } from "../model.ts";

const propertyKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

function tsType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
      return "unknown";
    case "null":
      return "null";
    case "bool":
      base = "boolean";
      break;
    case "int":
    case "float":
      base = "number";
      break;
    case "string":
      base = "string";
      break;
    case "map":
      base = `Record<string, ${tsType(type.items!)}>`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array": {
      const items = type.items!;
      const grouped = items.kind === "union" || (items.nullable && items.kind !== "null");
      base = grouped ? `(${tsType(items)})[]` : `${tsType(items)}[]`;
      break;
    }
    case "union":
      base = type.members!.map(tsType).join(" | ");
      break;
  }
  return type.nullable ? `${base} | null` : base;
}

export function emitTypeScript(model: Model): string {
  const blocks: string[] = [];
  if (model.root.kind !== "object") blocks.push(`export type Root = ${tsType(model.root)};`);
  for (const def of model.defsTopDown) {
    const lines = def.fields.map((field) => `  ${propertyKey(field.key)}${field.optional ? "?" : ""}: ${tsType(field.type)};`);
    blocks.push(`export interface ${def.name} {\n${lines.join("\n")}\n}`);
  }
  return blocks.join("\n\n") + "\n";
}

function zodType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
      return "z.unknown()";
    case "null":
      return "z.null()";
    case "bool":
      base = "z.boolean()";
      break;
    case "int":
      base = "z.number().int()";
      break;
    case "float":
      base = "z.number()";
      break;
    case "string":
      base = "z.string()";
      break;
    case "map":
      base = `z.record(z.string(), ${zodType(type.items!)})`;
      break;
    case "object":
      base = `${type.def!.name}Schema`;
      break;
    case "array":
      base = `z.array(${zodType(type.items!)})`;
      break;
    case "union":
      base = `z.union([${type.members!.map(zodType).join(", ")}])`;
      break;
  }
  return type.nullable ? `${base}.nullable()` : base;
}

export function emitZod(model: Model): string {
  const blocks = ['import { z } from "zod";'];
  // A schema must be declared before the schemas that use it
  for (const def of model.defs) {
    const lines = def.fields.map((field) => `  ${propertyKey(field.key)}: ${zodType(field.type)}${field.optional ? ".optional()" : ""},`);
    blocks.push(
      `export const ${def.name}Schema = z.object({\n${lines.join("\n")}\n});\n` +
        `export type ${def.name} = z.infer<typeof ${def.name}Schema>;`,
    );
  }
  if (model.root.kind !== "object") {
    blocks.push(`export const RootSchema = ${zodType(model.root)};\nexport type Root = z.infer<typeof RootSchema>;`);
  }
  return blocks.join("\n\n") + "\n";
}
