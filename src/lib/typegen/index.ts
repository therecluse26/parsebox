/**
 * Type generation: infer types or schemas (TypeScript, Zod, JSON Schema, Go...)
 * from the parsed value. The emitters load lazily with `import()`, so the
 * worker's entry chunk stays small.
 */
import { formatOptions } from "../../config/formats.ts";
import { LIMITS } from "../../config/limits.ts";

const typeFormats = new Set(formatOptions.filter((option) => option.group === "types").map((option) => option.value));

export function isTypeFormat(format: string): boolean {
  return typeFormats.has(format);
}

/**
 * Generates types for `value`, the parsed input. Arrays are sampled at
 * LIMITS.typegenSampleItems items; `notes` says so when that happened.
 */
export async function generateTypes(value: unknown, format: string): Promise<{ output: string; notes: string[] }> {
  if (!isTypeFormat(format)) throw new Error(`${format} is not a type format`);
  const { generate } = await import("./generate.ts");
  return generate(value, format, LIMITS.typegenSampleItems);
}
