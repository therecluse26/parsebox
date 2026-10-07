import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatOptions } from "../src/config/formats.ts";
import { LIMITS } from "../src/config/limits.ts";
import { generateTypes, isTypeFormat } from "../src/lib/typegen/index.ts";

const jsonDir = path.join(import.meta.dirname, "..", "test-data", "json");
const typeFormats = formatOptions.filter((option) => option.group === "types").map((option) => option.value);

test("the type formats are output-only and known to typegen", () => {
  assert.ok(typeFormats.length >= 11);
  for (const format of typeFormats) {
    assert.equal(isTypeFormat(format), true, format);
    assert.equal(formatOptions.find((option) => option.value === format)?.io, "output", format);
  }
  for (const format of ["auto", "json", "yaml", "csv", "base64"]) assert.equal(isTypeFormat(format), false, format);
});

// Every type format writes something for every JSON sample
for (const file of fs.readdirSync(jsonDir).sort()) {
  const value = JSON.parse(fs.readFileSync(path.join(jsonDir, file), "utf8"));
  for (const format of typeFormats) {
    test(`test-data/json/${file} → ${format}`, async () => {
      const { output, notes } = await generateTypes(value, format);
      assert.ok(output.trim().length > 0);
      assert.doesNotMatch(output, /undefined|\[object Object\]/);
      assert.deepEqual(notes, []);
      if (format === "jsonschema") assert.doesNotThrow(() => JSON.parse(output));
    });
  }
}

const expected: Record<string, Record<string, string[]>> = {
  "order-nested.json": {
    typescript: ["export interface Root {", "items: Item[];", "export interface Address {", "tracking: null;"],
    zod: ['import { z } from "zod";', "items: z.array(ItemSchema),", "quantity: z.number().int(),", "export type Root = z.infer<typeof RootSchema>;"],
    jsonschema: ['"$ref": "#/$defs/Customer"', '"format": "date-time"', '"type": "integer"'],
    go: ['import "time"', "type Root struct {", "time.Time `json:\"createdAt\"`", "[]Item", "`json:\"orderId\"`"],
    protobuf: ['syntax = "proto3";', "repeated Item items = 4;", "google.protobuf.Timestamp created_at = 2;", "message Address {"],
    rust: ['#[serde(rename_all = "camelCase")]', "pub struct Root {", "pub items: Vec<Item>,", "pub unit_price: f64,"],
    python: ["class Item(BaseModel):", 'unit_price: float = Field(alias="unitPrice")', "created_at: datetime", "items: list[Item]"],
    csharp: ['[JsonPropertyName("orderId")]', "public required string OrderId { get; set; }", "public required List<Item> Items { get; set; }"],
    kotlin: ["@Serializable", "data class Root(", "val items: List<Item>,"],
    swift: ["struct Root: Codable {", "let items: [Item]", "let unitPrice: Double"],
    java: ["public record Root(", "List<Item> items", "record Address("],
  },
  "users.json": {
    typescript: ["export type Root = RootItem[];", "email: string;", "active: boolean;"],
    zod: ["export const RootSchema = z.array(RootItemSchema);"],
    jsonschema: ['"type": "array"', '"$ref": "#/$defs/RootItem"'],
    go: ["type Root []RootItem"],
    protobuf: ["repeated RootItem items = 1;"],
    rust: ["pub type Root = Vec<RootItem>;"],
    python: ["class Root(RootModel[list[RootItem]]):"],
    kotlin: ["typealias Root = List<RootItem>"],
    swift: ["typealias Root = [RootItem]"],
  },
  "edge-cases.json": {
    typescript: ['"key with spaces": string;', "emptyArray: unknown[];", "emptyObject: Record<string, unknown>;", "mixedArray: (boolean | number | string | number[] | MixedArrayItem | null)[];"],
    go: ["KeyWithSpaces", '`json:"key with spaces"`', "MixedArray         []any"],
    rust: ['#[serde(rename = "key with spaces")]', "pub mixed_array: Vec<serde_json::Value>,"],
    swift: ['case keyWithSpaces = "key with spaces"', "enum JSONValue: Codable {"],
    protobuf: ['string key_with_spaces = 17 [json_name = "key with spaces"];', 'import "google/protobuf/struct.proto";'],
  },
};

for (const [file, byFormat] of Object.entries(expected)) {
  const value = JSON.parse(fs.readFileSync(path.join(jsonDir, file), "utf8"));
  for (const [format, fragments] of Object.entries(byFormat)) {
    test(`${file} → ${format} has the expected fragments`, async () => {
      const { output } = await generateTypes(value, format);
      for (const fragment of fragments) assert.ok(output.includes(fragment), `missing ${JSON.stringify(fragment)} in:\n${output}`);
    });
  }
}

test("languages without unions leave out types used only in unions", async () => {
  const value = { mixed: [1, { five: 5 }] };
  assert.match((await generateTypes(value, "typescript")).output, /interface MixedItem/);
  for (const format of ["go", "rust", "csharp", "kotlin", "swift", "java", "protobuf"]) {
    assert.doesNotMatch((await generateTypes(value, format)).output, /MixedItem/, format);
  }
  // Go must not import time for a date that only sits in a union
  assert.doesNotMatch((await generateTypes({ when: ["2026-01-01T00:00:00Z", 3] }, "go")).output, /import "time"/);
});

test("optional, nullable, ids, names and numbers", async () => {
  const value = {
    rows: [{ id: 1, note: "a", parent: null }, { id: 2, parent: 1 }],
    byId: { "1": { label: "one" }, "2": { label: "two" } },
    error: { code: 1 },
    huge: 6.022e23,
    big: 9_000_000_000,
    class: "keyword",
  };
  const ts = (await generateTypes(value, "typescript")).output;
  assert.match(ts, /rows: Row\[\];/);
  assert.match(ts, /note\?: string;/);
  assert.match(ts, /parent: number \| null;/);
  assert.match(ts, /byId: Record<string, ByIdValue>;/);
  assert.match(ts, /error: ErrorObject;/);

  const java = (await generateTypes(value, "java")).output;
  assert.match(java, /double huge/);
  assert.match(java, /long big/);
  assert.match(java, /@JsonProperty\("class"\) String class_/);

  const zod = (await generateTypes(value, "zod")).output;
  assert.match(zod, /note: z\.string\(\)\.optional\(\),/);
  assert.match(zod, /parent: z\.number\(\)\.int\(\)\.nullable\(\),/);
  // Schemas are declared before use
  assert.ok(zod.indexOf("export const RowSchema") < zod.indexOf("export const RootSchema"));

  assert.match((await generateTypes(value, "kotlin")).output, /val `class`: String,/);
  assert.match((await generateTypes(value, "python")).output, /class_: str = Field\(alias="class"\)/);
  assert.match((await generateTypes(value, "go")).output, /Note +\*string +`json:"note,omitempty"`/);
});

test("primitive and empty roots", async () => {
  for (const value of ["text", 42, null, [], {}]) {
    for (const format of typeFormats) {
      const { output } = await generateTypes(value, format);
      assert.ok(output.trim().length > 0, `${JSON.stringify(value)} → ${format}`);
    }
  }
});

function bigArray(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `user ${i}`,
    email: `user${i}@example.com`,
    active: i % 2 === 0,
    score: i * 1.5,
    tags: ["a", "b"],
    address: { street: "1 Main St", city: "Springfield", zip: String(10_000 + i) },
    createdAt: "2026-01-01T00:00:00Z",
    // Only after the sample: sampling must not see it
    ...(i >= 5_000 ? { late: true } : {}),
  }));
}

test("large arrays are sampled, with a note", async (t) => {
  const value = bigArray(84_000);
  const timings: string[] = [];
  for (const format of typeFormats) {
    const start = performance.now();
    const { output, notes } = await generateTypes(value, format);
    timings.push(`${format} ${(performance.now() - start).toFixed(1)} ms`);
    assert.deepEqual(notes, [`inferred from ${LIMITS.typegenSampleItems.toLocaleString("en-US")} of 84,000 items`]);
    assert.doesNotMatch(output, /late/i, format);
  }
  t.diagnostic(`84,000 items: ${timings.join(", ")}`);
  // The input is untouched
  assert.equal(value.length, 84_000);
  assert.equal(Object.keys(value[83_999]).includes("late"), true);
});

test("several sampled arrays are summed up in one note", async () => {
  const value = { a: Array.from({ length: 2_500 }, (_, i) => i), b: Array.from({ length: 1_200 }, (_, i) => `${i}`) };
  const { notes } = await generateTypes(value, "typescript");
  assert.deepEqual(notes, ["inferred from the first 1,000 items of 2 arrays (largest: 2,500)"]);
});

test("type generation stays fast on wide and deep input", async (t) => {
  const wide = bigArray(1_000).map((row) => ({ ...row, extra: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`field${i}`, i])) }));
  let deep: unknown = "bottom";
  for (let i = 0; i < 500; i++) deep = { child: deep };

  const start = performance.now();
  for (const format of typeFormats) {
    await generateTypes(wide, format);
    await generateTypes(deep, format);
  }
  const elapsed = performance.now() - start;
  t.diagnostic(`wide and deep, all formats: ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed < 2_000, `took ${elapsed} ms`);
});
