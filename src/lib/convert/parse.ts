import { XMLParser } from "fast-xml-parser";
import yaml from "js-yaml";
import { decode as toonDecode } from "@toon-format/toon";
import JSON5 from "json5";
import TOML from "@ltd/j-toml";
import ini from "ini";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { parse as dotenvParse } from "dotenv";
import qs from "qs";
import Papa from "papaparse";
import { TOML_PARSE_OPTIONS } from "../detectFormat.ts";
import { decodeJwt } from "../decodeChain.ts";
import { base64ToBytes, binaryToBytes, hexToBytes, utf8Text } from "./bytes.ts";

/**
 * Parse `text` as `format` (a format `value`, not "auto"). Throws when the text
 * is not valid. Unknown formats and "text" return the text unchanged.
 */
export function parseText(text: string, format: string): unknown {
  switch (format) {
    case "json":
      return JSON.parse(text);
    case "json5":
      return JSON5.parse(text);
    case "xml":
      return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
      }).parse(text);
    case "yaml":
      return yaml.load(text);
    case "toml":
      return TOML.parse(text, TOML_PARSE_OPTIONS);
    case "toon":
      return toonDecode(text);
    case "ini":
      return ini.parse(text);
    case "dotenv":
      return dotenvParse(text);
    case "csv":
      return Papa.parse(text, { header: true }).data;
    case "tsv":
      return Papa.parse(text, { header: true, delimiter: "\t" }).data;
    case "jsonl":
      return parseJsonl(text);
    case "msgpack":
      // MessagePack input is Base64 text of the binary data
      return msgpackDecode(base64ToBytes(text));
    case "base64":
      return bytesValue(base64ToBytes(text));
    case "hex":
      return bytesValue(hexToBytes(text));
    case "binary":
      return bytesValue(binaryToBytes(text));
    case "uri":
      return jsonOrString(decodeURIComponent(text));
    case "querystring":
      return parseQueryString(text.trim());
    case "jwt":
      return decodeJwt(text);
    default:
      return text;
  }
}

// One JSON value per non-blank line
function parseJsonl(text: string): unknown[] {
  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// qs's defaults turn arrays over 20 items into objects, flatten keys nested over 5
// levels and drop pairs after 1,000. The writer produces all of these, so lift the
// limits. An array index can still not exceed the pair count, so `a[99999999]=1`
// stays an object and cannot allocate a huge array.
function parseQueryString(query: string): unknown {
  let pairs = 1;
  for (let i = query.indexOf("&"); i !== -1; i = query.indexOf("&", i + 1)) pairs++;
  return qs.parse(query, { ignoreQueryPrefix: true, depth: Infinity, parameterLimit: Infinity, arrayLimit: pairs });
}

// Decoded bytes are UTF-8 text when they can be, otherwise they stay bytes
function bytesValue(bytes: Uint8Array): unknown {
  const text = utf8Text(bytes);
  return text === null ? bytes : jsonOrString(text);
}

// Decoded encodings become structured data when they hold JSON, otherwise they stay text
function jsonOrString(decoded: string): unknown {
  try {
    return JSON.parse(decoded);
  } catch {
    return decoded;
  }
}
