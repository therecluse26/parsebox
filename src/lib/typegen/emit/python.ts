import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { safeStart, snakeCase, uniqueIdents } from "../names.ts";

/** Python keywords and BaseModel attributes a field must not shadow */
const RESERVED = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
  "construct", "copy", "dict", "from_orm", "json", "model_config", "model_fields", "parse_file", "parse_obj",
  "parse_raw", "schema", "schema_json", "update_forward_refs", "validate",
]);

function fieldIdent(key: string): string {
  const ident = safeStart(snakeCase(key), "field", "field_");
  return RESERVED.has(ident) ? `${ident}_` : ident;
}

function pyType(type: TypeRef, typing: Set<string>): string {
  let base: string;
  switch (type.kind) {
    case "any":
      typing.add("Any");
      return "Any";
    case "null":
      typing.add("Any");
      typing.add("Optional");
      return "Optional[Any]";
    case "bool":
      base = "bool";
      break;
    case "int":
      base = "int";
      break;
    case "float":
      base = "float";
      break;
    case "string":
      base = type.date ? "datetime" : "str";
      break;
    case "map":
      base = `dict[str, ${pyType(type.items!, typing)}]`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array":
      base = `list[${pyType(type.items!, typing)}]`;
      break;
    case "union":
      typing.add("Union");
      base = `Union[${type.members!.map((member) => pyType(member, typing)).join(", ")}]`;
      break;
  }
  if (!type.nullable) return base;
  typing.add("Optional");
  return `Optional[${base}]`;
}

export function emitPython(model: Model): string {
  const typing = new Set<string>();
  const pydantic = new Set(["BaseModel"]);
  const classes: string[] = [];

  // A class must be defined before the classes that use it
  for (const def of model.defs) {
    const idents = uniqueIdents(def.fields.map((field) => field.key), fieldIdent);
    const lines = def.fields.map((field, i) => {
      let type = pyType(field.type, typing);
      if (field.optional && !type.startsWith("Optional[")) {
        typing.add("Optional");
        type = `Optional[${type}]`;
      }
      const alias = idents[i] === field.key ? null : JSON.stringify(field.key);
      if (alias) pydantic.add("Field");
      let value = "";
      if (alias && field.optional) value = ` = Field(default=None, alias=${alias})`;
      else if (alias) value = ` = Field(alias=${alias})`;
      else if (field.optional) value = " = None";
      return `    ${idents[i]}: ${type}${value}`;
    });
    classes.push(`class ${def.name}(BaseModel):\n${lines.join("\n")}`);
  }
  if (model.root.kind !== "object") {
    pydantic.add("RootModel");
    classes.push(`class Root(RootModel[${pyType(model.root, typing)}]):\n    pass`);
  }

  const imports: string[] = [];
  if (modelUses(model, (type) => type.kind === "string" && !!type.date)) imports.push("from datetime import datetime");
  if (typing.size) imports.push(`from typing import ${[...typing].sort().join(", ")}`);
  const head = imports.length ? `${imports.join("\n")}\n\n` : "";
  const pydanticLine = `from pydantic import ${[...pydantic].sort().join(", ")}`;
  return `${head}${pydanticLine}\n\n\n${classes.join("\n\n\n")}\n`;
}
