import type { ConversionRequest, ConversionResult } from "../lib/convert/types.ts";
import { LIMITS } from "../config/limits.ts";
import { runConversion, emptyResult } from "../lib/convert/pipeline.ts";
import { sizeLabel } from "../lib/convert/measure.ts";
import { highlightOutput, highlightLanguageFor, prepareHighlighting } from "./highlight.ts";

// The DOM lib types `self` as a window; in a worker postMessage takes no target origin
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConversionRequest>) => void) | null;
  postMessage: (result: ConversionResult) => void;
};

scope.onmessage = async (event) => {
  const request = event.data;
  let result: ConversionResult;
  try {
    result = await runConversion(request);
    if (result.output.length <= LIMITS.highlightMaxChars) await prepareHighlighting(result.outputFormatUsed);
    result.outputHtml = highlightOutput(result.output, result.outputFormatUsed);
    if (result.outputHtml === null && result.output.length > LIMITS.highlightMaxChars && highlightLanguageFor(result.outputFormatUsed)) {
      result.skipped.push(`highlighting (over ${sizeLabel(LIMITS.highlightMaxChars)})`);
    }
  } catch (error) {
    // The pipeline catches its own errors; this guards against a bug in it
    result = emptyResult(request);
    result.outputError = error instanceof Error ? error.message : String(error);
  }
  scope.postMessage(result);
};
