import type { Model, ObjectDef, TypeRef } from "../model.ts";

type Schema = Record<string, unknown>;

function withNull(schema: Schema): Schema {
  if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
  return { anyOf: [schema, { type: "null" }] };
}

function schemaFor(type: TypeRef): Schema {
  let schema: Schema;
  switch (type.kind) {
    case "any":
      return {};
    case "null":
      return { type: "null" };
    case "bool":
      schema = { type: "boolean" };
      break;
    case "int":
      schema = { type: "integer" };
      break;
    case "float":
      schema = { type: "number" };
      break;
    case "string":
      schema = type.date ? { type: "string", format: "date-time" } : { type: "string" };
      break;
    case "map": {
      const values = schemaFor(type.items!);
      schema = Object.keys(values).length ? { type: "object", additionalProperties: values } : { type: "object" };
      break;
    }
    case "object":
      schema = { $ref: `#/$defs/${type.def!.name}` };
      break;
    case "array": {
      const items = schemaFor(type.items!);
      schema = Object.keys(items).length ? { type: "array", items } : { type: "array" };
      break;
    }
    case "union":
      schema = { anyOf: type.members!.map(schemaFor) };
      break;
  }
  return type.nullable ? withNull(schema) : schema;
}

function objectSchema(def: ObjectDef): Schema {
  const properties: Schema = {};
  for (const field of def.fields) properties[field.key] = schemaFor(field.type);
  const required = def.fields.filter((field) => !field.optional).map((field) => field.key);
  return required.length ? { type: "object", properties, required } : { type: "object", properties };
}

export function emitJsonSchema(model: Model): string {
  const rootDef = model.root.kind === "object" ? model.root.def! : null;
  const body = rootDef ? objectSchema(rootDef) : schemaFor(model.root);
  const defs: Schema = {};
  for (const def of model.defsTopDown) if (def !== rootDef) defs[def.name] = objectSchema(def);

  const schema: Schema = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Root", ...body };
  if (Object.keys(defs).length) schema.$defs = defs;
  return JSON.stringify(schema, null, 2) + "\n";
}
