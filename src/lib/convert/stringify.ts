import { XMLBuilder } from "fast-xml-parser";
import yaml from "js-yaml";
import { encode as toonEncode } from "@toon-format/toon";
import JSON5 from "json5";
import TOML from "@ltd/j-toml";
import ini from "ini";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import qs from "qs";
import Papa from "papaparse";

/**
 * Write a parsed value as `format`. Throws when the format cannot hold the value
 * (for example TOML with an array at the root). Unknown formats and "text" write
 * primitives as they are and anything else as compact JSON.
 */
export function stringifyValue(value: unknown, format: string): string {
  const result = write(value, format);
  // Primitives (numbers, undefined from an empty document) pass through unstringified
  return result == null ? "" : String(result);
}

// The writers below treat arrays, objects and primitives differently
function write(value: any, format: string): unknown {
  const isArray = Array.isArray(value);
  const isPrimitive = !isArray && (typeof value !== "object" || value === null);

  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2);
    case "json5":
      return JSON5.stringify(value, null, 2);
    case "xml":
      return new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
      }).build(isArray ? { root: { item: value } } : value);
    case "yaml":
      // js-yaml's own scan for repeated objects (written as &anchors) is quadratic; skip it when there are none
      return yaml.dump(value, hasSharedObjects(value) ? undefined : { noRefs: true });
    case "toml":
      // TOML documents must be a table at the root
      if (isArray || isPrimitive) {
        throw new Error("TOML requires an object at the root");
      }
      // Without `newline`, j-toml returns an array of lines; `integer` keeps whole numbers from becoming floats
      return TOML.stringify(value, {
        newline: "\n",
        integer: Number.MAX_SAFE_INTEGER,
      });
    case "toon":
      return toonEncode(value);
    case "ini":
      return ini.stringify(value);
    case "dotenv":
      if (!isArray && !isPrimitive) {
        return Object.entries(value)
          .map(([key, item]) => `${key}=${item}`)
          .join("\n");
      }
      return String(value);
    case "csv":
      return Papa.unparse(isArray ? value : [value]);
    case "tsv":
      return Papa.unparse(isArray ? value : [value], { delimiter: "\t" });
    case "jsonl":
      return (isArray ? value : [value]).map((item: unknown) => JSON.stringify(item)).join("\n");
    case "msgpack":
      return bytesToBase64(msgpackEncode(value));
    case "base64":
      return btoa(unescape(encodeURIComponent(isPrimitive ? value : JSON.stringify(value))));
    case "hex":
      return (isPrimitive ? value : JSON.stringify(value))
        .split("")
        .map((char: string) => char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");
    case "binary":
      return (isPrimitive ? value : JSON.stringify(value))
        .split("")
        .map((char: string) => char.charCodeAt(0).toString(2).padStart(8, "0"))
        .join(" ");
    case "uri":
      return encodeURIComponent(isPrimitive ? value : JSON.stringify(value));
    case "querystring":
      return qs.stringify(value);
    default:
      return isPrimitive ? value : JSON.stringify(value);
  }
}

// True when an object or array is reached twice (YAML aliases parse that way, and so do cycles)
function hasSharedObjects(root: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node)) return true;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
    } else {
      for (const key of Object.keys(node)) stack.push((node as Record<string, unknown>)[key]);
    }
  }
  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks; spreading a large array overflows the call stack
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
