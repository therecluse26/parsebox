import React, { useState, useRef, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyntaxHighlightedEditor } from "./SyntaxHighlightedEditor";
import { LineGutter } from "./LineGutter";
import { FormatSelect } from "./FormatSelect";
import { DecodeChain } from "./notices/DecodeChain";
import { RepairNotice } from "./notices/RepairNotice";
import { SecretsNotice } from "./notices/SecretsNotice";
import { LossReport } from "./notices/LossReport";
import { formatLabel, isInputOnly, isOutputOnly } from "@/config/formats";
import { LIMITS } from "@/config/limits";
import { countLines, sizeLabel } from "@/lib/convert/measure";
import { useConversion, useDelayedFlag } from "@/hooks/useConversion";

const formatByteSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
};

// "secret scan (over 10 MB)" → "secret scan skipped (over 10 MB)"
const skippedNote = (item: string) =>
  item.includes(" (") ? item.replace(" (", " skipped (") : `${item} skipped`;

export default function SideBySideEditor() {
  const [inputText, setInputText] = useState("");
  const [inputFormat, setInputFormat] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("text");
  // False: in auto mode the output format follows the detected format
  const [isOutputFormatManuallySet, setIsOutputFormatManuallySet] = useState(false);
  const [redactSecrets, setRedactSecrets] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { result, busy } = useConversion({
    text: inputText,
    inputFormat,
    outputFormat,
    outputFormatLocked: isOutputFormatManuallySet,
    redactSecrets,
  });
  const converting = useDelayedFlag(busy, 300);

  const following = inputFormat === "auto" && !isOutputFormatManuallySet;
  const activeOutputFormat = following && result ? result.outputFormatUsed : outputFormat;
  const detectedFormat = result?.detectedFormat ? formatLabel(result.detectedFormat) ?? null : null;
  const parseError = result?.parseError ?? null;
  // Error positions refer to the innermost layer, which is not the text in the input pane
  const errorLine = parseError?.line !== undefined && result?.decodeChain.length === 0 ? parseError.line : undefined;

  const output = result?.output ?? "";
  const displayOutput = useMemo(
    () => (output.length > LIMITS.displayMaxChars ? output.slice(0, LIMITS.displayMaxChars) : output),
    [output]
  );
  const inputLines = useMemo(() => countLines(inputText), [inputText]);
  const outputLines = useMemo(() => countLines(displayOutput), [displayOutput]);
  const hasInput = useMemo(() => /\S/.test(inputText), [inputText]);
  // Byte counts come from the worker, so big input is never encoded on the main thread
  const inputBytes = result?.inputBytes ?? 0;
  const outputBytes = result?.outputBytes ?? 0;

  const handleOutputFormatChange = (newFormat: string) => {
    setOutputFormat(newFormat);
    setIsOutputFormatManuallySet(true);
  };

  const handleInputFormatChange = (newFormat: string) => {
    // Leaving auto mode keeps the output format it showed
    if (inputFormat === "auto" && newFormat !== "auto") setOutputFormat(activeOutputFormat);
    setInputFormat(newFormat);
    // Reset the manual flag when switching to auto mode
    if (newFormat === "auto") {
      setIsOutputFormatManuallySet(false);
    }
  };

  const swapBlockedReason = isOutputOnly(activeOutputFormat)
    ? `Swap is unavailable: ${formatLabel(activeOutputFormat) ?? activeOutputFormat} is output only`
    : null;

  const handleSwap = () => {
    if (swapBlockedReason) return;
    const previousInputFormat = inputFormat === "auto" ? result?.inputFormatUsed ?? "text" : inputFormat;
    setInputText(output);
    setInputFormat(activeOutputFormat);
    setOutputFormat(isInputOnly(previousInputFormat) ? "json" : previousInputFormat);
    // The new input format is never auto, so the output format stays as set
    setIsOutputFormatManuallySet(true);
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard
      .writeText(output)
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  };

  // Put the caret on the error and scroll it into view
  const jumpToError = () => {
    const textarea = inputRef.current;
    if (!textarea || errorLine === undefined) return;
    let start = 0;
    for (let line = 1; line < errorLine; line++) {
      const next = inputText.indexOf("\n", start);
      if (next === -1) break;
      start = next + 1;
    }
    const lineEnd = inputText.indexOf("\n", start);
    const column = Math.max((parseError?.column ?? 1) - 1, 0);
    const caret = Math.min(start + column, lineEnd === -1 ? inputText.length : lineEnd);
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
    textarea.scrollTop = Math.max(0, (errorLine - 1) * lineHeight - textarea.clientHeight / 3);
  };

  const activeFormatLabel = inputFormat === "auto" ? detectedFormat : formatLabel(inputFormat);

  let inputStatus: React.ReactNode = null;
  if (hasInput && result) {
    if (parseError) {
      const message = parseError.hint ? `${parseError.message} · ${parseError.hint}` : parseError.message;
      inputStatus =
        errorLine !== undefined ? (
          <button
            type="button"
            className="min-w-0 truncate text-left hover:underline"
            onClick={jumpToError}
            title={`${message} (go to line ${errorLine})`}
          >
            <StatusText tone="error" text={message} />
          </button>
        ) : (
          <StatusText tone="error" text={message} />
        );
    } else if (result.repair && activeFormatLabel) {
      inputStatus = <StatusText tone="ok" text={`repaired ${activeFormatLabel.toLowerCase()}`} />;
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
  } else if (result?.outputError) {
    outputStatus = <StatusText tone="error" text={result.outputError} />;
  } else if (inputBytes > 0 && outputBytes > 0) {
    const change = Math.round(((outputBytes - inputBytes) / inputBytes) * 100);
    outputStatus = (
      <span>{change === 0 ? "±0" : change > 0 ? `+${change}` : `−${-change}`}% size</span>
    );
  }

  const outputNotes: string[] = [];
  if (converting) outputNotes.push("converting…");
  if (output.length > displayOutput.length) {
    outputNotes.push(`showing first ${sizeLabel(LIMITS.displayMaxChars)} · copy copies all`);
  }
  if (result) outputNotes.push(...result.notes, ...result.skipped.map(skippedNote));

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4 md:flex-row md:px-7 md:pb-7 md:pt-5">
      <EditorPane
        side="in"
        value={inputText}
        onChange={setInputText}
        textareaRef={inputRef}
        format={inputFormat}
        onFormatChange={handleInputFormatChange}
        readOnly={false}
        detectedFormat={detectedFormat}
        chars={inputText.length}
        byteSize={inputBytes}
        lineCount={inputLines}
        errorLine={errorLine}
        status={inputStatus}
        notices={
          <>
            <DecodeChain steps={result?.decodeChain ?? []} innerFormat={result?.detectedFormat ?? null} />
            <RepairNotice repair={result?.repair ?? null} />
            <SecretsNotice secrets={result?.secrets ?? null} redact={redactSecrets} onRedactChange={setRedactSecrets} />
          </>
        }
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
        {/* A disabled button gets no hover, so the wrapper carries the tooltip */}
        <span title={swapBlockedReason ?? undefined}>
          <Button
            size="icon"
            className="h-11 w-11 rounded"
            onClick={handleSwap}
            disabled={swapBlockedReason !== null}
            aria-label={swapBlockedReason ?? "Swap input and output"}
          >
            <ArrowLeftRight className="h-[18px] w-[18px] rotate-90 md:rotate-0" />
          </Button>
        </span>
      </div>
      <EditorPane
        side="out"
        value={displayOutput}
        html={result?.outputHtml ?? null}
        format={activeOutputFormat}
        onFormatChange={handleOutputFormatChange}
        readOnly={true}
        chars={output.length}
        byteSize={outputBytes}
        lineCount={outputLines}
        status={outputStatus}
        footerNote={outputNotes.join(" · ")}
        notices={<LossReport losses={result?.losses ?? null} />}
        toolbarAction={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 rounded border-input bg-popover text-xs"
            onClick={handleCopyToClipboard}
            disabled={!output}
          >
            {copySuccess ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copySuccess ? "copied" : "copy"}
          </Button>
        }
      />
    </div>
  );
}

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
  /** The text shown, which for the output can be a slice of the full output */
  value: string;
  onChange?: (value: string) => void;
  /** highlight.js HTML for `value`; shown instead of the textarea when present */
  html?: string | null;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  format: string;
  onFormatChange: (value: string) => void;
  readOnly: boolean;
  chars: number;
  byteSize: number;
  lineCount: number;
  errorLine?: number;
  status: React.ReactNode;
  /** Dim text after the size in the footer */
  footerNote?: string;
  /** Notices above the footer; the row hides when they all render nothing */
  notices?: React.ReactNode;
  toolbarAction: React.ReactNode;
  detectedFormat?: string | null;
}

function EditorPane({
  side,
  value,
  onChange,
  html,
  textareaRef,
  format,
  onFormatChange,
  readOnly,
  chars,
  byteSize,
  lineCount,
  errorLine,
  status,
  footerNote,
  notices,
  toolbarAction,
  detectedFormat,
}: EditorPaneProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
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
        <LineGutter ref={gutterRef} count={lineCount} errorLine={errorLine} />
        <div className="relative min-w-0 flex-1">
          {html && value ? (
            <SyntaxHighlightedEditor html={html} onScroll={handleScroll} />
          ) : (
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
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
      <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto border-t px-3.5 py-1.5 text-xs empty:hidden">
        {notices}
      </div>
      <div className="flex justify-between gap-3 border-t px-3.5 py-2 text-xs text-dim">
        <span className="shrink-0">
          {chars} chars · {formatByteSize(byteSize)}
        </span>
        {footerNote && (
          <span className="min-w-0 flex-1 truncate" title={footerNote}>
            {footerNote}
          </span>
        )}
        {status}
      </div>
    </section>
  );
}
