/**
 * Size caps that keep ParseBox fast on large input. Above a cap, the feature
 * does not run and the result lists it in `skipped`.
 *
 * Sizes are in characters of the input text (close to bytes for ASCII).
 */
export const LIMITS = {
  /** Wait this long after the last keystroke before converting */
  debounceMs: 200,
  /** Inputs under this size convert with no debounce, so small edits feel instant */
  instantMaxChars: 20_000,

  /** The output pane shows at most this much; copy still copies the full output */
  displayMaxChars: 2_000_000,
  /** Syntax highlighting runs only on output up to this size */
  highlightMaxChars: 300_000,

  /** jsonrepair runs only on invalid input up to this size */
  repairMaxChars: 20_000_000,
  /** Fix descriptions shown in the repair notice */
  repairFixesShown: 5,

  /** Maximum layers the decode chain removes */
  decodeMaxDepth: 5,
  /** Decompression stops at this many bytes (zip-bomb guard) */
  decompressMaxBytes: 50 * 1024 * 1024,

  /** The secret scan runs only on input up to this size */
  secretsMaxChars: 10_000_000,
  /** The scan stops after this many findings */
  secretsMaxFindings: 200,

  /** Paths listed per loss kind */
  lossExamples: 20,

  /** Type generation infers from at most this many items of each array */
  typegenSampleItems: 1_000,
} as const;
