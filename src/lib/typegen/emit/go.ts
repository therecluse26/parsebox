import { modelUses } from "../model.ts";
import type { Model, TypeRef } from "../model.ts";
import { safeStart, uniqueIdents, words } from "../names.ts";

/** Go spells these words in capitals: OrderID, not OrderId */
const INITIALISMS = new Set([
  "acl", "api", "ascii", "cpu", "css", "dns", "eof", "guid", "html", "http", "https", "id", "ip", "json", "lhs", "qps",
  "ram", "rhs", "rpc", "sla", "smtp", "sql", "ssh", "tcp", "tls", "ttl", "udp", "ui", "uid", "uri", "url", "utf8", "uuid",
  "vm", "xml", "xmpp", "xsrf", "xss",
]);

const fieldName = (key: string) =>
  safeStart(
    words(key)
      .map((word) => (INITIALISMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
      .join(""),
    "Field",
    "X",
  );

function goType(type: TypeRef, optional = false): string {
  let base: string;
  switch (type.kind) {
    case "any":
    case "null":
    case "union":
      return "any";
    case "bool":
      base = "bool";
      break;
    case "int":
      base = "int64";
      break;
    case "float":
      base = "float64";
      break;
    case "string":
      base = type.date ? "time.Time" : "string";
      break;
    case "object":
      base = type.def!.name;
      break;
    // Slices and maps already have nil
    case "map":
      return `map[string]${goType(type.items!)}`;
    case "array":
      return `[]${goType(type.items!)}`;
  }
  return type.nullable || optional ? `*${base}` : base;
}

/** Struct tags are Go string literals; JSON.stringify gives the same escapes */
const tag = (key: string, optional: boolean) => `\`json:${JSON.stringify(key + (optional ? ",omitempty" : ""))}\``;

export function emitGo(model: Model): string {
  const blocks: string[] = [];
  if (modelUses(model, (type) => type.kind === "string" && !!type.date)) blocks.push('import "time"');
  if (model.root.kind !== "object") blocks.push(`type Root ${goType(model.root)}`);

  for (const def of model.defsTopDown) {
    const names = uniqueIdents(def.fields.map((field) => field.key), fieldName);
    const types = def.fields.map((field) => goType(field.type, field.optional));
    // Align the columns as gofmt does
    const nameWidth = Math.max(...names.map((name) => name.length));
    const typeWidth = Math.max(...types.map((type) => type.length));
    const lines = def.fields.map(
      (field, i) => `\t${names[i].padEnd(nameWidth)} ${types[i].padEnd(typeWidth)} ${tag(field.key, field.optional)}`,
    );
    blocks.push(`type ${def.name} struct {\n${lines.join("\n")}\n}`);
  }
  return blocks.join("\n\n") + "\n";
}
