import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { camelCase, safeStart, uniqueIdents } from "../names.ts";

const KEYWORDS = new Set([
  "Any", "Self", "as", "associatedtype", "break", "case", "catch", "class", "continue", "default", "defer", "deinit", "do",
  "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func", "guard", "if", "import", "in", "init",
  "inout", "internal", "is", "let", "nil", "open", "operator", "private", "protocol", "public", "repeat", "rethrows",
  "return", "self", "static", "struct", "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias",
  "var", "where", "while",
]);

const fieldIdent = (key: string) => {
  const ident = safeStart(camelCase(key), "field", "_");
  return KEYWORDS.has(ident) ? `\`${ident}\`` : ident;
};

/** Holds any JSON value, for keys whose values have mixed types */
const JSON_VALUE = `enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}`;

function swiftType(type: TypeRef): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "union":
      base = "JSONValue";
      break;
    case "null":
      return "JSONValue?";
    case "bool":
      base = "Bool";
      break;
    case "int":
      base = "Int";
      break;
    case "float":
      base = "Double";
      break;
    case "string":
      base = "String";
      break;
    case "map":
      base = `[String: ${swiftType(type.items!)}]`;
      break;
    case "object":
      base = type.def!.name;
      break;
    case "array":
      base = `[${swiftType(type.items!)}]`;
      break;
  }
  return type.nullable ? `${base}?` : base;
}

/** Codable structs; optional properties decode both null and missing keys */
export function emitSwift(model: Model): string {
  const blocks: string[] = [];
  if (model.root.kind !== "object") blocks.push(`typealias Root = ${swiftType(model.root)}`);

  for (const def of model.defsTopDown) {
    const idents = uniqueIdents(def.fields.map((field) => field.key), fieldIdent);
    const props = def.fields.map((field, i) => {
      let type = swiftType(field.type);
      if (field.optional && !type.endsWith("?")) type += "?";
      return `    let ${idents[i]}: ${type}`;
    });
    let body = props.join("\n");
    // CodingKeys are needed only when a property name differs from its key
    if (def.fields.some((field, i) => idents[i].replace(/`/g, "") !== field.key)) {
      const cases = def.fields.map((field, i) =>
        idents[i].replace(/`/g, "") === field.key ? `        case ${idents[i]}` : `        case ${idents[i]} = ${JSON.stringify(field.key)}`,
      );
      body += `\n\n    enum CodingKeys: String, CodingKey {\n${cases.join("\n")}\n    }`;
    }
    blocks.push(`struct ${def.name}: Codable {\n${body}\n}`);
  }
  if (modelUses(model, (type) => type.kind === "any" || type.kind === "null" || type.kind === "union")) blocks.push(JSON_VALUE);
  return blocks.join("\n\n") + "\n";
}
