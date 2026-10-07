/**
 * Type generation: infer types or schemas (TypeScript, Zod, JSON Schema, Go...)
 * from the parsed value. Heavy code must load lazily with `import()`, so the
 * main bundle does not grow.
 *
 * STUB: no type formats yet. The type-generation feature replaces this body.
 */
export function isTypeFormat(_format: string): boolean {
  return false;
}

export async function generateTypes(_value: unknown, format: string): Promise<{ output: string; notes: string[] }> {
  throw new Error(`Type generation for ${format} is not available yet`);
}
