import React, { useState, useEffect, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight, Minimize2, Maximize2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import yaml from "js-yaml";
import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon';
import JSON5 from 'json5';
import TOML from '@ltd/j-toml';
import ini from 'ini';
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';
import { parse as dotenvParse } from 'dotenv';
import qs from 'qs';
import { SyntaxHighlightedEditor } from './SyntaxHighlightedEditor';
// @ts-ignore
declare const Papa: any;

const formatOptions = [
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

type IntermediateState = {
  type: "primitive" | "array" | "object";
  value: any;
};

const formatByteSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
};

const shouldHighlight = (format: string): boolean => {
  return ['json', 'json5', 'xml', 'yaml', 'toml', 'toon', 'ini', 'jsonl'].includes(format);
};

const getHighlightLanguage = (format: string): string => {
  const languageMap: Record<string, string> = {
    'json': 'json',
    'json5': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'toml': 'toml',
    'toon': 'yaml',
    'ini': 'ini',
    'jsonl': 'json',
  };
  return languageMap[format] || 'plaintext';
};

export default function SideBySideEditor() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [inputFormat, setInputFormat] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("text");
  const [intermediateState, setIntermediateState] =
    useState<IntermediateState | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const [isOutputFormatManuallySet, setIsOutputFormatManuallySet] = useState(false);

  const detectFormat = (text: string): string => {
    // Try JSON
    try {
      JSON.parse(text);
      setDetectedFormat("JSON");
      return "json";
    } catch {}

    // Try JSON5 (JSON with comments/trailing commas)
    try {
      JSON5.parse(text);
      // Check if it has JSON5-specific features (comments, trailing commas, unquoted keys)
      if (text.includes('//') || text.includes('/*') || /,\s*[}\]]/.test(text)) {
        setDetectedFormat("JSON5");
        return "json5";
      }
    } catch {}
  
    // Try XML
    try {
      new XMLParser().parse(text);
      if (text.trim().startsWith('<') && text.trim().endsWith('>')) {
        setDetectedFormat("XML");
        return "xml";
      }
    } catch {}
  
    // Try TOML
    try {
      TOML.parse(text);
      // TOML typically has [section] headers or key = value
      if (/^\[[\w.]+\]/m.test(text) || /^\w+\s*=/.test(text)) {
        setDetectedFormat("TOML");
        return "toml";
      }
    } catch {}

    // Try YAML
    try {
      yaml.load(text);
      if (text.includes(':') && !text.includes('{') && !text.includes('[')) {
        setDetectedFormat("YAML");
        return "yaml";
      }
    } catch {}

    // Try TOON
    try {
      // TOON detection heuristics:
      // 1. Array length declarations like [N]:
      // 2. Tabular field declarations like {field1,field2}:
      const hasToonArraySyntax = /\[\d+\]:/.test(text);
      const hasToonTableSyntax = /\{[\w,]+\}:/.test(text);
      const hasIndentation = /^\s+/m.test(text);
      const hasColonNewlines = text.includes(':\n') || text.includes(':\r\n');

      if ((hasToonArraySyntax || hasToonTableSyntax) && (hasIndentation || hasColonNewlines)) {
        // Verify it's valid TOON
        toonDecode(text);
        setDetectedFormat("TOON");
        return "toon";
      }
    } catch {}

    // Try INI
    try {
      ini.parse(text);
      // INI has [section] headers or key=value (no spaces around =)
      if (/^\[[\w\s]+\]/m.test(text) && /^\w+=/.test(text)) {
        setDetectedFormat("INI");
        return "ini";
      }
    } catch {}

    // Try dotenv
    try {
      dotenvParse(Buffer.from(text));
      // dotenv typically has KEY=value format (often uppercase keys)
      if (/^[A-Z_]+=/.test(text) || text.split('\n').every(line =>
        line.trim() === '' || line.startsWith('#') || /^\w+=/.test(line)
      )) {
        setDetectedFormat("dotenv");
        return "dotenv";
      }
    } catch {}

    // Try JSONL
    try {
      const lines = text.trim().split('\n');
      if (lines.length > 1 && lines.every(line => {
        try {
          JSON.parse(line.trim());
          return true;
        } catch {
          return false;
        }
      })) {
        setDetectedFormat("JSONL");
        return "jsonl";
      }
    } catch {}

    // Try CSV
    try {
      const result = Papa.parse(text, { header: true });
      if (result.data.length > 0 && Object.keys(result.data[0]).length > 1) {
        setDetectedFormat("CSV");
        return "csv";
      }
    } catch {}

    // Try TSV
    try {
      const result = Papa.parse(text, { header: true, delimiter: "\t" });
      if (result.data.length > 0 && Object.keys(result.data[0]).length > 1 && text.includes('\t')) {
        setDetectedFormat("TSV");
        return "tsv";
      }
    } catch {}
  
    // Try MessagePack (base64-encoded binary)
    try {
      const msgpackBinary = Uint8Array.from(atob(text), c => c.charCodeAt(0));
      msgpackDecode(msgpackBinary);
      // If it decodes successfully and looks like base64, it's MessagePack
      if (/^[A-Za-z0-9+/]+=*$/.test(text.trim())) {
        setDetectedFormat("MessagePack");
        return "msgpack";
      }
    } catch {}

    // Try Base64
    try {
      const decoded = atob(text);
      if (text === btoa(decoded)) {
        setDetectedFormat("Base64")
        return "base64";
      }
    } catch {}
  
    // Try Hex
    if (/^[0-9A-Fa-f\s]+$/.test(text)) {
      setDetectedFormat("Hexadecimal");
      return "hex";
    }
  
    // Try Binary
    if (/^[01\s]+$/.test(text)) {
      setDetectedFormat("Binary");
      return "binary";
    }
  
    // Try URI
    try {
      const decoded = decodeURIComponent(text);
      if (text !== decoded && text.includes('%')) {
        setDetectedFormat("URI Encoded");
        return "uri";
      }
    } catch {}

    // Try Query String
    try {
      const parsed = qs.parse(text);
      // Check if it looks like a query string (key=value&key2=value2)
      if (typeof parsed === 'object' && Object.keys(parsed).length > 0 &&
          (text.includes('=') && (text.includes('&') || !text.includes(' ')))) {
        setDetectedFormat("Query String");
        return "querystring";
      }
    } catch {}

    setDetectedFormat("Plain Text");
    return "text";
  };

  const parseInput = useCallback(
    (text: string, format: string): IntermediateState => {
      try {
        let actualFormat = format;
        if (format === "auto") {
          actualFormat = detectFormat(text);
          // Auto-sync output format if not manually set
          if (!isOutputFormatManuallySet) {
            setOutputFormat(actualFormat);
          }
        }

        let parsed: any;
        switch (actualFormat) {
          case "json":
            parsed = JSON.parse(text);
            break;
          case "json5":
            parsed = JSON5.parse(text);
            break;
          case "xml":
            parsed = new XMLParser({
              ignoreAttributes: false,
              attributeNamePrefix: "@_",
              textNodeName: "#text",
            }).parse(text);
            break;
          case "yaml":
            parsed = yaml.load(text);
            break;
          case "toml":
            parsed = TOML.parse(text);
            break;
          case "toon":
            parsed = toonDecode(text);
            break;
          case "ini":
            parsed = ini.parse(text);
            break;
          case "dotenv":
            parsed = dotenvParse(Buffer.from(text));
            break;
          case "csv":
            parsed = Papa.parse(text, { header: true }).data;
            break;
          case "tsv":
            parsed = Papa.parse(text, { header: true, delimiter: "\t" }).data;
            break;
          case "jsonl":
            parsed = text
              .trim()
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => JSON.parse(line));
            break;
          case "msgpack":
            // Decode base64 to binary, then decode MessagePack
            const msgpackBinary = Uint8Array.from(atob(text), c => c.charCodeAt(0));
            parsed = msgpackDecode(msgpackBinary);
            break;
          case "base64":
            const decodedText = atob(text);
            try {
              parsed = JSON.parse(decodedText);
            } catch {
              parsed = decodedText;
            }
            break;
          case "hex":
            parsed = text
              .match(/.{1,2}/g)
              ?.map((byte) => String.fromCharCode(parseInt(byte, 16)))
              .join("");
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // If it's not valid JSON, keep it as a string
            }
            break;
          case "binary":
            parsed = text
              .replace(/\s/g, "")
              .match(/.{1,8}/g)
              ?.map((byte) => String.fromCharCode(parseInt(byte, 2)))
              .join("");
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // If it's not valid JSON, keep it as a string
            }
            break;
          case "uri":
            parsed = decodeURIComponent(text);
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // If it's not valid JSON, keep it as a string
            }
            break;
          case "querystring":
            parsed = qs.parse(text);
            break;
          default:
            parsed = text;
        }

        if (Array.isArray(parsed)) {
          return { type: "array", value: parsed };
        } else if (typeof parsed === "object" && parsed !== null) {
          return { type: "object", value: parsed };
        } else {
          return { type: "primitive", value: parsed };
        }
      } catch (error) {
        console.error(`Error parsing ${format}:`, error);
        return { type: "primitive", value: `Error: Could not parse ${format}` };
      }
    },
    [isOutputFormatManuallySet]
  );

  const stringifyOutput = useCallback(
    (state: IntermediateState, format: string): string => {
      try {
        let result: string;
        switch (format) {
          case "json":
            result = JSON.stringify(state.value, null, 2);
            break;
          case "json5":
            result = JSON5.stringify(state.value, null, 2);
            break;
          case "xml":
            const xmlBuilder = new XMLBuilder({
              ignoreAttributes: false,
              format: true,
              attributeNamePrefix: "@_",
              textNodeName: "#text",
            });
            result = xmlBuilder.build(
              state.type === "array"
                ? { root: { item: state.value } }
                : state.value
            );
            break;
          case "yaml":
            result = yaml.dump(state.value);
            break;
          case "toml":
            result = TOML.stringify(state.value);
            break;
          case "toon":
            result = toonEncode(state.value);
            break;
          case "ini":
            result = ini.stringify(state.value);
            break;
          case "dotenv":
            // Manually stringify to dotenv format (key=value)
            if (state.type === "object") {
              result = Object.entries(state.value)
                .map(([key, value]) => `${key}=${value}`)
                .join("\n");
            } else {
              result = String(state.value);
            }
            break;
          case "csv":
            result = Papa.unparse(
              state.type === "array" ? state.value : [state.value]
            );
            break;
          case "tsv":
            result = Papa.unparse(
              state.type === "array" ? state.value : [state.value],
              { delimiter: "\t" }
            );
            break;
          case "jsonl":
            const jsonlArray = state.type === "array" ? state.value : [state.value];
            result = jsonlArray.map((item: any) => JSON.stringify(item)).join("\n");
            break;
          case "msgpack":
            // Encode to MessagePack binary, then convert to base64
            const msgpackEncoded = msgpackEncode(state.value);
            result = btoa(String.fromCharCode(...msgpackEncoded));
            break;
          case "base64":
            const stringToEncode =
              state.type === "primitive"
                ? state.value
                : JSON.stringify(state.value);
            result = btoa(unescape(encodeURIComponent(stringToEncode)));
            break;
          case "hex":
            const stringToHex =
              state.type === "primitive"
                ? state.value
                : JSON.stringify(state.value);
            result = stringToHex
              .split("")
              .map((char: string) =>
                char.charCodeAt(0).toString(16).padStart(2, "0")
              )
              .join("");
            break;
          case "binary":
            const stringToBinary =
              state.type === "primitive"
                ? state.value
                : JSON.stringify(state.value);
            result = stringToBinary
              .split("")
              .map((char: string) =>
                char.charCodeAt(0).toString(2).padStart(8, "0")
              )
              .join(" ");
            break;
          case "uri":
            const stringToUri =
              state.type === "primitive"
                ? state.value
                : JSON.stringify(state.value);
            result = encodeURIComponent(stringToUri);
            break;
          case "querystring":
            result = qs.stringify(state.value);
            break;
          default:
            result =
              state.type === "primitive"
                ? state.value
                : JSON.stringify(state.value);
        }
        return result;
      } catch (error) {
        console.error(`Error stringifying to ${format}:`, error);
        return `Error: Could not convert to ${format}`;
      }
    },
    []
  );

  const handleOutputFormatChange = (newFormat: string) => {
    setOutputFormat(newFormat);
    setIsOutputFormatManuallySet(true);
  };

  const handleInputFormatChange = (newFormat: string) => {
    setInputFormat(newFormat);
    // Reset the manual flag when switching to auto mode
    if (newFormat === "auto") {
      setIsOutputFormatManuallySet(false);
    }
  };

  const handleConvert = useCallback(() => {
    const newIntermediateState = parseInput(inputText, inputFormat);
    setIntermediateState(newIntermediateState);
    const convertedOutput = stringifyOutput(newIntermediateState, outputFormat);
    setOutputText(convertedOutput);
  }, [inputText, inputFormat, outputFormat, parseInput, stringifyOutput]);

  useEffect(() => {
    handleConvert();
  }, [handleConvert]);

  const handleSwap = () => {
    setInputText(outputText);
    setOutputText(inputText);
    const newInputFormat = outputFormat;
    const newOutputFormat = inputFormat;
    setInputFormat(newInputFormat);
    setOutputFormat(newOutputFormat);
    setIntermediateState(null);
    // Update manual flag based on new input format
    if (newInputFormat === "auto") {
      setIsOutputFormatManuallySet(false);
    } else {
      setIsOutputFormatManuallySet(true);
    }
  };

  const handleMinify = () => {
    if (intermediateState) {
      const minified = JSON.stringify(intermediateState.value);
      setOutputText(minified);
    }
  };

  const handleBeautify = () => {
    if (intermediateState) {
      const beautified = JSON.stringify(intermediateState.value, null, 2);
      setOutputText(beautified);
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard
      .writeText(outputText)
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  };

  return (
    <div className="flex flex-col h-full justify-center mt-4">
      <div className="flex flex-1 min-h-0">
        <EditorPane
          value={inputText}
          onChange={setInputText}
          format={inputFormat}
          onFormatChange={handleInputFormatChange}
          readOnly={false}
          detectedFormat={detectedFormat}
        />
        <div className="flex items-center mx-4">
          <Button variant="secondary" onClick={handleSwap}>
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        </div>
        <EditorPane
          value={outputText}
          onChange={() => {}}
          format={outputFormat}
          onFormatChange={handleOutputFormatChange}
          readOnly={true}
          floatingButtons={
            <div className="absolute top-2 right-4 flex space-x-2">
              <Button size="sm" variant="secondary" className="hover:bg-primary" onClick={handleCopyToClipboard}>
                {copySuccess ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  readOnly: boolean;
  floatingButtons?: React.ReactNode;
  detectedFormat?: string|null
}

function EditorPane({
  value,
  onChange,
  format,
  onFormatChange,
  readOnly,
  floatingButtons,
  detectedFormat
}: EditorPaneProps) {
  const charCount = value.length;
  const byteSize = new Blob([value]).size;

  return (
    <div className="flex-1 flex flex-col relative min-w-0">
      <div className="p-2 border-b">
        <Select value={format} onValueChange={onFormatChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formatOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label} {option.value === 'auto' && value && detectedFormat && '(' + (detectedFormat) + ')'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 relative min-h-0">
        {shouldHighlight(format) && readOnly ? (
          <SyntaxHighlightedEditor
            value={value}
            onChange={onChange}
            language={getHighlightLanguage(format)}
            readOnly={readOnly}
            className="rounded-none border-0"
            placeholder={readOnly ? "Output will appear here..." : "Enter your text here..."}
          />
        ) : (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-full w-full resize-none rounded-none border-0 font-mono
              scrollbar-thin scrollbar-thumb-primary scrollbar-track-background"
            placeholder={
              readOnly ? "Output will appear here..." : "Enter your text here..."
            }
            readOnly={readOnly}
          />
        )}
        {floatingButtons}
      </div>
      <div className="p-2 text-sm text-gray-500">
        Characters: {charCount} | {formatByteSize(byteSize)}
      </div>
    </div>
  );
}
