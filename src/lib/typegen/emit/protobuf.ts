import type { Model, ObjectDef, TypeRef } from "../model.ts";
import { safeStart, snakeCase, uniqueIdents } from "../names.ts";

/** The JSON name protobuf derives from a field name: order_id → orderId */
const protoJsonName = (name: string) => name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/** A field type: scalars and messages, or `repeated` for arrays */
function protoType(type: TypeRef, imports: Set<string>): string {
  switch (type.kind) {
    case "any":
    case "null":
    case "union":
      imports.add("google/protobuf/struct.proto");
      return "google.protobuf.Value";
    case "bool":
      return "bool";
    case "int":
      return type.big ? "int64" : "int32";
    case "float":
      return "double";
    case "string":
      if (!type.date) return "string";
      imports.add("google/protobuf/timestamp.proto");
      return "google.protobuf.Timestamp";
    case "map": {
      const values = type.items!;
      // Map values cannot be repeated; JSON objects of anything are a Struct
      if (values.kind === "array" || values.kind === "map" || values.kind === "any" || values.kind === "null" || values.kind === "union") {
        imports.add("google/protobuf/struct.proto");
        return "google.protobuf.Struct";
      }
      return `map<string, ${protoType(values, imports)}>`;
    }
    case "object":
      return type.def!.name;
    case "array": {
      const items = type.items!;
      // Lists of lists have no repeated form
      if (items.kind === "array" || (items.kind === "map" && protoType(items, imports).startsWith("map<"))) {
        imports.add("google/protobuf/struct.proto");
        return "google.protobuf.ListValue";
      }
      return `repeated ${protoType(items, imports)}`;
    }
  }
}

const SCALARS = new Set(["bool", "int32", "int64", "double", "string"]);

function message(def: ObjectDef, imports: Set<string>): string {
  const names = uniqueIdents(def.fields.map((field) => field.key), (key) => safeStart(snakeCase(key), "field", "field_"));
  const lines = def.fields.map((field, i) => {
    let type = protoType(field.type, imports);
    // Scalars need `optional` to tell a missing or null value from a zero value
    if ((field.optional || field.type.nullable) && SCALARS.has(type)) type = `optional ${type}`;
    const jsonName = field.key === names[i] || field.key === protoJsonName(names[i]) ? "" : ` [json_name = ${JSON.stringify(field.key)}]`;
    return `  ${type} ${names[i]} = ${i + 1}${jsonName};`;
  });
  return `message ${def.name} {\n${lines.join("\n")}\n}`;
}

export function emitProtobuf(model: Model): string {
  const imports = new Set<string>();
  const blocks: string[] = [];
  if (model.root.kind !== "object") {
    // A message is the only top-level type, so the root value goes in a field
    const field = model.root.kind === "array" ? "items" : "value";
    blocks.push(`// The input is not an object, so Root wraps it in "${field}"\n` + message({ name: "Root", fields: [{ key: field, type: model.root, optional: false }] }, imports));
  }
  for (const def of model.defsTopDown) blocks.push(message(def, imports));

  const head = ['syntax = "proto3";', [...imports].sort().map((path) => `import "${path}";`).join("\n")].filter(Boolean);
  return `${head.join("\n\n")}\n\n${blocks.join("\n\n")}\n`;
}
