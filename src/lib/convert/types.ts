/**
 * The contract between the UI, the conversion worker and the feature stages.
 *
 * Lib modules under src/lib must stay free of React and DOM-only APIs, so that
 * they run in the worker and in `node --test`. Import other src modules with a
 * relative path and the `.ts` extension; import types with `import type`.
 */

/** A message from the UI to the worker. */
export interface ConversionRequest {
  /** Increases with each request; the UI drops any result with an older id */
  id: number;
  text: string;
  /** A format `value` from `formatOptions`, or "auto" */
  inputFormat: string;
  /** A format `value` from `formatOptions` */
  outputFormat: string;
  /** False: the output format follows the detected input format (auto mode only) */
  outputFormatLocked: boolean;
  options: ConversionOptions;
}

export interface ConversionOptions {
  /** Replace the values of found secrets in the output */
  redactSecrets: boolean;
}

/** A message from the worker to the UI. */
export interface ConversionResult {
  id: number;
  /** The full output. The UI shows only the first LIMITS.displayMaxChars; copy uses all of it. */
  output: string;
  /** highlight.js HTML for the output, or null when the format has no highlighting or the output is over the cap */
  outputHtml: string | null;

  /** In auto mode: the detected format of the innermost layer. Otherwise null. */
  detectedFormat: string | null;
  /** The format the parser used for the innermost layer */
  inputFormatUsed: string;
  /** The format the writer used (differs from the request when the output follows the input) */
  outputFormatUsed: string;

  parseError: ParseErrorInfo | null;
  outputError: string | null;

  /** Set when the input was invalid and repair made it parse */
  repair: RepairInfo | null;
  /** Layers removed before parsing, outermost first. Empty when the input had no layers. */
  decodeChain: DecodeStep[];
  /** Null when the scan did not run (input over the cap) */
  secrets: SecretFinding[] | null;
  /** Null when nothing is lost or the report did not run */
  losses: LossReport | null;
  /** Short notes for the output footer, for example "Inferred from 1,000 of 84,000 items" */
  notes: string[];
  /** Features that did not run because the input was too large, for example "secret scan (over 10 MB)" */
  skipped: string[];

  inputBytes: number;
  outputBytes: number;
  inputLines: number;
  outputLines: number;
  elapsedMs: number;
}

export interface ParseErrorInfo {
  message: string;
  /** 1-based; absent when the parser gave no position */
  line?: number;
  /** 1-based; absent when the parser gave no position */
  column?: number;
  /** A short suggested fix, for example "Remove the trailing comma" */
  hint?: string;
}

export interface RepairInfo {
  /** The format that the repaired text parsed as */
  format: string;
  /** Short descriptions of each fix, capped at LIMITS.repairFixesShown */
  fixes: string[];
  /** Total fixes, which can be more than `fixes.length` */
  fixCount: number;
}

export interface DecodeStep {
  /** A format `value` or a layer id: "base64", "hex", "binary", "uri", "gzip", "deflate", "jwt", "json-string" */
  layer: string;
  /** For display, for example "Base64" or "gzip" */
  label: string;
}

export interface SecretFinding {
  /** Path in the parsed value, for example "db.password" or "[3].token"; "" for the root */
  path: string;
  /** For display, for example "AWS access key" or "Password field" */
  kind: string;
  /** "prefix" (known token prefix), "key-name" (suspicious key), "entropy" (random-looking) */
  rule: "prefix" | "key-name" | "entropy";
  /** The value with most characters masked, for example "AKIA••••••••3XQZ" */
  preview: string;
}

export interface LossReport {
  /** Fixed facts about the format pair, for example "All values become strings" */
  rules: string[];
  items: LossItem[];
}

export interface LossItem {
  /** For example "nested objects flattened", "arrays dropped", "nulls dropped", "numbers became strings" */
  kind: string;
  count: number;
  /** Paths of the first affected values, capped at LIMITS.lossExamples */
  examples: string[];
}
