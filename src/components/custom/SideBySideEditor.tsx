import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { LineGutter } from './LineGutter';
import { FormatSelect } from './FormatSelect';
import { formatOptions } from '@/config/formats';
import { detectFormat as detectInputFormat, TOML_PARSE_OPTIONS } from '@/lib/detectFormat';
// @ts-ignore
declare const Papa: any;


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
  const [parseError, setParseError] = useState<string | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);

  const detectFormat = (text: string): string => {
    const format = detectInputFormat(text);
    setDetectedFormat(formatOptions.find((option) => option.value === format)?.label ?? null);
    return format;
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
            parsed = TOML.parse(text, TOML_PARSE_OPTIONS);
            break;
          case "toon":
            parsed = toonDecode(text);
            break;
          case "ini":
            parsed = ini.parse(text);
            break;
          case "dotenv":
            parsed = dotenvParse(text);
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
              .replace(/\s/g, "")
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
            parsed = qs.parse(text.trim(), { ignoreQueryPrefix: true });
            break;
          default:
            parsed = text;
        }

        setParseError(null);
        if (Array.isArray(parsed)) {
          return { type: "array", value: parsed };
        } else if (typeof parsed === "object" && parsed !== null) {
          return { type: "object", value: parsed };
        } else {
          return { type: "primitive", value: parsed };
        }
      } catch (error) {
        console.error(`Error parsing ${format}:`, error);
        setParseError(error instanceof Error ? error.message : String(error));
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
            // TOML documents must be a table at the root
            if (state.type !== "object") {
              throw new Error("TOML requires an object at the root");
            }
            // Without `newline`, j-toml returns an array of lines; `integer` keeps whole numbers from becoming floats
            result = TOML.stringify(state.value, {
              newline: "\n",
              integer: Number.MAX_SAFE_INTEGER,
            });
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
            // Build the binary string in chunks; spreading a large array overflows the call stack
            let msgpackBinaryString = "";
            for (let i = 0; i < msgpackEncoded.length; i += 0x8000) {
              msgpackBinaryString += String.fromCharCode(...msgpackEncoded.subarray(i, i + 0x8000));
            }
            result = btoa(msgpackBinaryString);
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
        setOutputError(null);
        return result;
      } catch (error) {
        console.error(`Error stringifying to ${format}:`, error);
        setOutputError(error instanceof Error ? error.message : String(error));
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
    // Primitives (numbers, undefined from an empty document) pass through unstringified
    setOutputText(convertedOutput == null ? "" : String(convertedOutput));
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

  const inputBytes = byteLength(inputText);
  const outputBytes = byteLength(outputText);
  const activeFormatLabel =
    inputFormat === "auto"
      ? detectedFormat
      : formatOptions.find((option) => option.value === inputFormat)?.label;

  let inputStatus: React.ReactNode = null;
  if (inputText.trim() !== "") {
    if (parseError) {
      inputStatus = <StatusText tone="error" text={parseError} />;
    } else if (activeFormatLabel === "Plain Text") {
      inputStatus = <span>plain text</span>;
    } else if (activeFormatLabel) {
      inputStatus = <StatusText tone="ok" text={`valid ${activeFormatLabel.toLowerCase()}`} />;
    }
  }

  // A parse error already shows in the input footer; the output error would only echo it
  let outputStatus: React.ReactNode = null;
  if (parseError) {
    outputStatus = null;
  } else if (outputError) {
    outputStatus = <StatusText tone="error" text={outputError} />;
  } else if (inputBytes > 0 && outputBytes > 0) {
    const change = Math.round(((outputBytes - inputBytes) / inputBytes) * 100);
    outputStatus = (
      <span>{change === 0 ? "±0" : change > 0 ? `+${change}` : `−${-change}`}% size</span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4 md:flex-row md:px-7 md:pb-7 md:pt-5">
      <EditorPane
        side="in"
        value={inputText}
        onChange={setInputText}
        format={inputFormat}
        onFormatChange={handleInputFormatChange}
        readOnly={false}
        detectedFormat={detectedFormat}
        byteSize={inputBytes}
        status={inputStatus}
        toolbarAction={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setInputText("")}
            disabled={!inputText}
          >
            clear
          </Button>
        }
      />
      <div className="flex items-center justify-center">
        <Button
          size="icon"
          className="h-11 w-11 rounded"
          onClick={handleSwap}
          aria-label="Swap input and output"
        >
          <ArrowLeftRight className="h-[18px] w-[18px] rotate-90 md:rotate-0" />
        </Button>
      </div>
      <EditorPane
        side="out"
        value={outputText}
        onChange={() => {}}
        format={outputFormat}
        onFormatChange={handleOutputFormatChange}
        readOnly={true}
        byteSize={outputBytes}
        status={outputStatus}
        toolbarAction={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 rounded border-input bg-popover text-xs"
            onClick={handleCopyToClipboard}
            disabled={!outputText}
          >
            {copySuccess ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copySuccess ? "copied" : "copy"}
          </Button>
        }
      />
    </div>
  );
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

function StatusText({ tone, text }: { tone: "ok" | "error"; text: string }) {
  return (
    <span
      className={tone === "ok" ? "truncate text-success" : "truncate text-destructive"}
      title={text}
    >
      {tone === "ok" ? "✓" : "✗"} {text}
    </span>
  );
}

interface EditorPaneProps {
  side: "in" | "out";
  value: string;
  onChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  readOnly: boolean;
  byteSize: number;
  status: React.ReactNode;
  toolbarAction: React.ReactNode;
  detectedFormat?: string | null;
}

function EditorPane({
  side,
  value,
  onChange,
  format,
  onFormatChange,
  readOnly,
  byteSize,
  status,
  toolbarAction,
  detectedFormat,
}: EditorPaneProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;
  const placeholder = readOnly ? "output will appear here..." : "paste or type anything...";

  // Keep the line numbers aligned with the scrolled text
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  return (
    <section
      aria-label={side === "in" ? "Input" : "Output"}
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border bg-card focus-within:border-input"
    >
      <div className="flex items-center justify-between gap-3 border-b py-2 pl-3.5 pr-2.5">
        <div className="flex min-w-0 items-center gap-2.5 text-[13px]">
          <span className="text-dim">{side}</span>
          <FormatSelect
            side={side}
            value={format}
            onChange={onFormatChange}
            detectedFormat={value ? detectedFormat : null}
          />
        </div>
        {toolbarAction}
      </div>
      <div className="flex min-h-0 flex-1">
        <LineGutter ref={gutterRef} count={lineCount} />
        <div className="relative min-w-0 flex-1">
          {shouldHighlight(format) && readOnly ? (
            <SyntaxHighlightedEditor
              value={value}
              onChange={onChange}
              onScroll={handleScroll}
              language={getHighlightLanguage(format)}
              readOnly={readOnly}
              placeholder={placeholder}
            />
          ) : (
            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={handleScroll}
              wrap="off"
              spellCheck={false}
              className="h-full w-full resize-none whitespace-pre rounded-none border-0 bg-transparent py-3 pl-1 pr-3 font-mono text-sm leading-[1.5] md:leading-[1.5] caret-primary shadow-none placeholder:text-dim focus-visible:ring-0"
              placeholder={placeholder}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between gap-3 border-t px-3.5 py-2 text-xs text-dim">
        <span className="shrink-0">
          {value.length} chars · {formatByteSize(byteSize)}
        </span>
        {status}
      </div>
    </section>
  );
}
