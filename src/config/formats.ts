export type FormatGroup = "mode" | "data" | "encoding" | "types";

export interface FormatOption {
  value: string;
  label: string;
  /** Heading in the format select */
  group: FormatGroup;
  /** "input": parse only (shown in the in select). "output": write only (shown in the out select). */
  io: "both" | "input" | "output";
}

export const formatGroupLabels: Record<FormatGroup, string> = {
  mode: "Mode",
  data: "Data formats",
  encoding: "Encodings",
  types: "Types & schemas",
};

export const formatOptions: FormatOption[] = [
  { value: "auto", label: "Auto Detect", group: "mode", io: "input" },
  { value: "text", label: "Plain Text", group: "data", io: "both" },
  { value: "json", label: "JSON", group: "data", io: "both" },
  { value: "json5", label: "JSON5", group: "data", io: "both" },
  { value: "xml", label: "XML", group: "data", io: "both" },
  { value: "yaml", label: "YAML", group: "data", io: "both" },
  { value: "toml", label: "TOML", group: "data", io: "both" },
  { value: "toon", label: "TOON", group: "data", io: "both" },
  { value: "ini", label: "INI", group: "data", io: "both" },
  { value: "dotenv", label: "dotenv", group: "data", io: "both" },
  { value: "csv", label: "CSV", group: "data", io: "both" },
  { value: "tsv", label: "TSV", group: "data", io: "both" },
  { value: "jsonl", label: "JSONL", group: "data", io: "both" },
  { value: "querystring", label: "Query String", group: "data", io: "both" },
  { value: "msgpack", label: "MessagePack", group: "encoding", io: "both" },
  { value: "base64", label: "Base64", group: "encoding", io: "both" },
  { value: "hex", label: "Hexadecimal", group: "encoding", io: "both" },
  { value: "binary", label: "Binary", group: "encoding", io: "both" },
  { value: "uri", label: "URI Encoded", group: "encoding", io: "both" },
  { value: "jwt", label: "JWT", group: "encoding", io: "input" },
];

export const formatLabel = (value: string): string | undefined =>
  formatOptions.find((option) => option.value === value)?.label;

export const isOutputOnly = (value: string) =>
  formatOptions.find((option) => option.value === value)?.io === "output";

export const isInputOnly = (value: string) =>
  formatOptions.find((option) => option.value === value)?.io === "input";

// "Auto Detect" is a mode, not a format
export const formatCount = formatOptions.filter((option) => option.group !== "mode").length;
