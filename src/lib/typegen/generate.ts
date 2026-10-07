/**
 * The type emitters. index.ts loads this module with `import()` the first
 * time a type format is chosen, so it stays out of the worker's entry chunk.
 */
import { buildModel, withoutUnions } from "./model.ts";
import type { Model } from "./model.ts";
import { emitCSharp } from "./emit/csharp.ts";
import { emitGo } from "./emit/go.ts";
import { emitJava } from "./emit/java.ts";
import { emitJsonSchema } from "./emit/jsonSchema.ts";
import { emitKotlin } from "./emit/kotlin.ts";
import { emitProtobuf } from "./emit/protobuf.ts";
import { emitPython } from "./emit/python.ts";
import { emitRust } from "./emit/rust.ts";
import { emitSwift } from "./emit/swift.ts";
import { emitTypeScript, emitZod } from "./emit/typescript.ts";

/** Languages with union types get the full model; the others print unions as their "any" type */
const unionFormats = new Set(["typescript", "zod", "jsonschema", "python"]);

const emitters: Record<string, (model: Model) => string> = {
  typescript: emitTypeScript,
  zod: emitZod,
  jsonschema: emitJsonSchema,
  go: emitGo,
  protobuf: emitProtobuf,
  rust: emitRust,
  python: emitPython,
  csharp: emitCSharp,
  kotlin: emitKotlin,
  swift: emitSwift,
  java: emitJava,
};

export function generate(value: unknown, format: string, sampleItems: number): { output: string; notes: string[] } {
  const emit = emitters[format];
  if (!emit) throw new Error(`No type generator for ${format}`);

  const { model, sample } = buildModel(value, sampleItems);
  const notes: string[] = [];
  if (sample.sampledArrays > 0) {
    const kept = sampleItems.toLocaleString("en-US");
    const total = sample.largestLength.toLocaleString("en-US");
    notes.push(
      sample.sampledArrays === 1
        ? `inferred from ${kept} of ${total} items`
        : `inferred from the first ${kept} items of ${sample.sampledArrays.toLocaleString("en-US")} arrays (largest: ${total})`,
    );
  }
  return { output: emit(unionFormats.has(format) ? model : withoutUnions(model)), notes };
}
