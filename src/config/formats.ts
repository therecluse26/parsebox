export type FormatGroup = "mode" | "data" | "encoding" | "types";

export interface FormatOption {
  value: string;
  label: string;
  /** Heading in the format select */
  group: FormatGroup;
  /** "input": parse only (shown in the in select). "output": write only (shown in the out select). */
  io: "both" | "input" | "output";
  /** Extra search terms for the format select, for example "yml" for YAML */
  aliases?: string[];
}

export const formatGroupLabels: Record<FormatGroup, string> = {
  mode: "Mode",
  data: "Data formats",
  encoding: "Encodings",
  types: "Types & schemas",
};

export const formatOptions: FormatOption[] = [
  { value: "auto", label: "Auto Detect", group: "mode", io: "input", aliases: ["detect"] },
  { value: "text", label: "Plain Text", group: "data", io: "both", aliases: ["txt", "string"] },
  { value: "json", label: "JSON", group: "data", io: "both" },
  { value: "json5", label: "JSON5", group: "data", io: "both" },
  { value: "xml", label: "XML", group: "data", io: "both" },
  { value: "yaml", label: "YAML", group: "data", io: "both", aliases: ["yml"] },
  { value: "toml", label: "TOML", group: "data", io: "both" },
  { value: "toon", label: "TOON", group: "data", io: "both" },
  { value: "ini", label: "INI", group: "data", io: "both", aliases: ["cfg", "conf"] },
  { value: "dotenv", label: "dotenv", group: "data", io: "both", aliases: ["env", ".env"] },
  { value: "csv", label: "CSV", group: "data", io: "both", aliases: ["comma separated", "spreadsheet"] },
  { value: "tsv", label: "TSV", group: "data", io: "both", aliases: ["tab separated"] },
  { value: "jsonl", label: "JSONL", group: "data", io: "both", aliases: ["ndjson", "json lines"] },
  { value: "querystring", label: "Query String", group: "data", io: "both", aliases: ["qs", "url params", "form data"] },
  { value: "msgpack", label: "MessagePack", group: "encoding", io: "both" },
  { value: "base64", label: "Base64", group: "encoding", io: "both", aliases: ["b64"] },
  { value: "hex", label: "Hexadecimal", group: "encoding", io: "both", aliases: ["base16"] },
  { value: "binary", label: "Binary", group: "encoding", io: "both", aliases: ["bin", "bits"] },
  { value: "uri", label: "URI Encoded", group: "encoding", io: "both", aliases: ["url encoded", "percent encoding"] },
  { value: "jwt", label: "JWT", group: "encoding", io: "input", aliases: ["json web token", "bearer token"] },
  { value: "typescript", label: "TypeScript", group: "types", io: "output", aliases: ["ts", "interface"] },
  { value: "zod", label: "Zod", group: "types", io: "output", aliases: ["validation", "typescript schema"] },
  { value: "jsonschema", label: "JSON Schema", group: "types", io: "output", aliases: ["schema", "openapi"] },
  { value: "go", label: "Go", group: "types", io: "output", aliases: ["golang", "struct"] },
  { value: "protobuf", label: "Protobuf", group: "types", io: "output", aliases: ["proto", "protocol buffers", "grpc"] },
  { value: "rust", label: "Rust (serde)", group: "types", io: "output", aliases: ["rs", "serde"] },
  { value: "python", label: "Python (Pydantic)", group: "types", io: "output", aliases: ["py", "pydantic"] },
  { value: "csharp", label: "C#", group: "types", io: "output", aliases: ["cs", "dotnet", ".net"] },
  { value: "kotlin", label: "Kotlin", group: "types", io: "output", aliases: ["kt"] },
  { value: "swift", label: "Swift", group: "types", io: "output", aliases: ["codable", "ios"] },
  { value: "java", label: "Java", group: "types", io: "output", aliases: ["record", "jackson", "pojo"] },
];

export const formatLabel = (value: string): string | undefined =>
  formatOptions.find((option) => option.value === value)?.label;

export const isOutputOnly = (value: string) =>
  formatOptions.find((option) => option.value === value)?.io === "output";

export const isInputOnly = (value: string) =>
  formatOptions.find((option) => option.value === value)?.io === "input";

// "Auto Detect" is a mode, not a format
export const formatCount = formatOptions.filter((option) => option.group !== "mode").length;
