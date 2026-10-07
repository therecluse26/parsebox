import type { ConversionRequest, ConversionResult, RepairInfo } from "./types.ts";
import { LIMITS } from "../../config/limits.ts";
import { isInputOnly } from "../../config/formats.ts";
import { detectFormatWithValue } from "../detectFormat.ts";
import type { Detection } from "../detectFormat.ts";
import { peelLayers } from "../decodeChain.ts";
import { tryRepair, describeParseError } from "../repair.ts";
import { scanSecrets, redactSecrets } from "../secrets.ts";
import { collectLosses } from "../losses.ts";
import { isTypeFormat, generateTypes } from "../typegen/index.ts";
import { parseText } from "./parse.ts";
import { stringifyValue } from "./stringify.ts";
import { countLines, utf8Length, sizeLabel } from "./measure.ts";

const JSON_FORMATS = new Set(["json", "json5", "jsonl"]);

/** The feature stages the pipeline calls. Tests swap them; the app uses the defaults. */
export interface Features {
  peelLayers: typeof peelLayers;
  tryRepair: typeof tryRepair;
  describeParseError: typeof describeParseError;
  scanSecrets: typeof scanSecrets;
  redactSecrets: typeof redactSecrets;
  collectLosses: typeof collectLosses;
  isTypeFormat: typeof isTypeFormat;
  generateTypes: typeof generateTypes;
}

const FEATURES: Features = {
  peelLayers,
  tryRepair,
  describeParseError,
  scanSecrets,
  redactSecrets,
  collectLosses,
  isTypeFormat,
  generateTypes,
};

/**
 * Convert the request's text: decode layers, detect, parse (with repair),
 * scan for secrets, write the output format and report losses. Everything
 * except highlighting, so it runs the same in the worker and in node.
 *
 * Feature stages run inside try/catch: a failing feature counts as "did not
 * run" and never breaks the conversion.
 */
export async function runConversion(
  req: ConversionRequest,
  features: Features = FEATURES
): Promise<ConversionResult> {
  const { peelLayers, tryRepair, describeParseError, scanSecrets, redactSecrets, collectLosses, isTypeFormat, generateTypes } = features;
  const started = performance.now();
  const auto = req.inputFormat === "auto";
  const result = emptyResult(req);

  if (!/\S/.test(req.text)) {
    result.detectedFormat = auto ? "text" : null;
    result.inputFormatUsed = auto ? "text" : req.inputFormat;
    result.outputFormatUsed = followedOutputFormat(req, result.inputFormatUsed);
    return finish(result, req.text, started);
  }

  // Auto mode: remove encoding layers, then detect the innermost text
  let inner = req.text;
  let format = req.inputFormat;
  let detected: Detection | null = null;
  if (auto) {
    try {
      const peeled = await peelLayers(req.text);
      inner = peeled.text;
      result.decodeChain = peeled.steps;
      if (peeled.format) {
        format = peeled.format;
      } else {
        detected = detectFormatWithValue(inner);
        format = detected.format;
      }
    } catch (error) {
      result.parseError = { message: errorMessage(error) };
      result.inputFormatUsed = "text";
      result.outputFormatUsed = followedOutputFormat(req, "text");
      return finish(result, req.text, started);
    }
  }

  let value: unknown;
  let parsed = false;
  const useRepair = (repaired: { value: unknown; info: RepairInfo }) => {
    value = repaired.value;
    result.repair = repaired.info;
    format = repaired.info.format;
    parsed = true;
  };

  // Broken JSON often parses as YAML (or plain text) and would never be flagged, so try repair first
  if (auto && !JSON_FORMATS.has(format) && inner.length <= LIMITS.repairMaxChars && startsWithBracket(inner)) {
    const repaired = attempt(() => tryRepair(inner));
    if (repaired) useRepair(repaired);
  }

  // Parse, reusing the value detection already parsed when it has one
  if (!parsed) {
    if (detected && "value" in detected && detected.format === format) {
      value = detected.value;
      parsed = true;
    } else {
      try {
        value = parseText(inner, format);
        parsed = true;
      } catch (error) {
        if (JSON_FORMATS.has(format)) {
          if (inner.length <= LIMITS.repairMaxChars) {
            const repaired = attempt(() => tryRepair(inner));
            if (repaired) useRepair(repaired);
          } else {
            result.skipped.push(`repair (over ${sizeLabel(LIMITS.repairMaxChars)})`);
          }
        }
        if (!parsed) {
          result.parseError = attempt(() => describeParseError(error, inner, format)) ?? { message: errorMessage(error) };
        }
      }
    }
  }

  result.detectedFormat = auto ? format : null;
  result.inputFormatUsed = format;
  result.outputFormatUsed = followedOutputFormat(req, format);
  if (!parsed) return finish(result, req.text, started);

  // Secrets
  if (req.text.length <= LIMITS.secretsMaxChars) {
    result.secrets = attempt(() => scanSecrets(value));
  } else {
    result.skipped.push(`secret scan (over ${sizeLabel(LIMITS.secretsMaxChars)})`);
  }
  if (req.options.redactSecrets && result.secrets && result.secrets.length > 0) {
    try {
      value = redactSecrets(value, result.secrets);
    } catch (error) {
      // Never show secrets the user asked to hide
      result.outputError = `Could not redact secrets: ${errorMessage(error)}`;
      return finish(result, req.text, started);
    }
  }

  // Write the output (or generate types)
  const outputFormat = result.outputFormatUsed;
  try {
    if (attempt(() => isTypeFormat(outputFormat))) {
      const generated = await generateTypes(value, outputFormat);
      result.output = generated.output;
      result.notes.push(...generated.notes);
    } else {
      result.output = stringifyValue(value, outputFormat);
    }
  } catch (error) {
    result.outputError = errorMessage(error);
    result.output = "";
  }

  // What the output format could not keep
  if (!result.outputError) {
    result.losses = attempt(() => collectLosses(value, format, outputFormat));
  }

  return finish(result, req.text, started);
}

/** A result with nothing in it, for the request's id. */
export function emptyResult(req: ConversionRequest): ConversionResult {
  return {
    id: req.id,
    output: "",
    outputHtml: null,
    detectedFormat: null,
    inputFormatUsed: req.inputFormat,
    outputFormatUsed: req.outputFormat,
    parseError: null,
    outputError: null,
    repair: null,
    decodeChain: [],
    secrets: null,
    losses: null,
    notes: [],
    skipped: [],
    inputBytes: 0,
    outputBytes: 0,
    inputLines: 1,
    outputLines: 1,
    elapsedMs: 0,
  };
}

// In auto mode the output follows the detected format until the user picks one
function followedOutputFormat(req: ConversionRequest, format: string): string {
  if (req.inputFormat !== "auto" || req.outputFormatLocked) return req.outputFormat;
  return isInputOnly(format) ? "json" : format;
}

function finish(result: ConversionResult, text: string, started: number): ConversionResult {
  result.inputBytes = utf8Length(text);
  result.outputBytes = utf8Length(result.output);
  result.inputLines = countLines(text);
  result.outputLines = countLines(result.output);
  result.elapsedMs = performance.now() - started;
  return result;
}

// Runs a feature stage; a throw counts as "did not run"
function attempt<T>(stage: () => T): T | null {
  try {
    return stage();
  } catch {
    return null;
  }
}

function startsWithBracket(text: string): boolean {
  const match = /\S/.exec(text);
  return match !== null && (match[0] === "{" || match[0] === "[");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
