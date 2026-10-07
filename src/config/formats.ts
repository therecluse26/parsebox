export const formatOptions = [
  { value: "auto", label: "Auto Detect" },
  { value: "text", label: "Plain Text" },
  { value: "json", label: "JSON" },
  { value: "json5", label: "JSON5" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" },
  { value: "toon", label: "TOON" },
  { value: "ini", label: "INI" },
  { value: "dotenv", label: "dotenv" },
  { value: "csv", label: "CSV" },
  { value: "tsv", label: "TSV" },
  { value: "jsonl", label: "JSONL" },
  { value: "msgpack", label: "MessagePack" },
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hexadecimal" },
  { value: "binary", label: "Binary" },
  { value: "uri", label: "URI Encoded" },
  { value: "querystring", label: "Query String" },
];

// "Auto Detect" is a mode, not a format
export const formatCount = formatOptions.length - 1;
