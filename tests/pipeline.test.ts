import { test } from "node:test";
import assert from "node:assert/strict";
import { runConversion } from "../src/lib/convert/pipeline.ts";
import { countLines, utf8Length } from "../src/lib/convert/measure.ts";
import type { Features } from "../src/lib/convert/pipeline.ts";
import type { ConversionRequest } from "../src/lib/convert/types.ts";
import { LIMITS } from "../src/config/limits.ts";
import { peelLayers } from "../src/lib/decodeChain.ts";
import { tryRepair, describeParseError } from "../src/lib/repair.ts";
import { scanSecrets, redactSecrets } from "../src/lib/secrets.ts";
import { collectLosses } from "../src/lib/losses.ts";
import { isTypeFormat, generateTypes } from "../src/lib/typegen/index.ts";

const request = (text: string, overrides: Partial<ConversionRequest> = {}): ConversionRequest => ({
  id: 1,
  text,
  inputFormat: "auto",
  outputFormat: "text",
  outputFormatLocked: false,
  options: { redactSecrets: false },
  ...overrides,
});

// The real feature modules, with some stages swapped per test
const features = (overrides: Partial<Features> = {}): Features => ({
  peelLayers,
  tryRepair,
  describeParseError,
  scanSecrets,
  redactSecrets,
  collectLosses,
  isTypeFormat,
  generateTypes,
  ...overrides,
});

const fail = () => {
  throw new Error("feature bug");
};

test("empty input gives an empty result", async () => {
  const result = await runConversion(request("  \n "));
  assert.equal(result.output, "");
  assert.equal(result.detectedFormat, "text");
  assert.equal(result.outputFormatUsed, "text");
  assert.equal(result.parseError, null);
  assert.equal(result.id, 1);
});

test("auto mode detects the format and the output follows it", async () => {
  const result = await runConversion(request('{"a":1}'));
  assert.equal(result.detectedFormat, "json");
  assert.equal(result.inputFormatUsed, "json");
  assert.equal(result.outputFormatUsed, "json");
  assert.equal(result.output, '{\n  "a": 1\n}');
  assert.equal(result.inputBytes, 7);
  assert.equal(result.outputLines, 3);
});

test("a locked output format wins over the detected format", async () => {
  const result = await runConversion(request('{"a":1}', { outputFormat: "yaml", outputFormatLocked: true }));
  assert.equal(result.outputFormatUsed, "yaml");
  assert.equal(result.output, "a: 1\n");
});

test("explicit mode uses the chosen formats and reports no detected format", async () => {
  const result = await runConversion(request("a: 1", { inputFormat: "yaml", outputFormat: "json" }));
  assert.equal(result.detectedFormat, null);
  assert.equal(result.output, '{\n  "a": 1\n}');
});

test("a parse error leaves the output empty", async () => {
  const result = await runConversion(request("{bad", { inputFormat: "json", outputFormat: "yaml" }));
  assert.ok(result.parseError?.message);
  assert.equal(result.output, "");
  assert.equal(result.outputError, null);
  assert.equal(result.losses, null);
});

test("an output error keeps the parse result", async () => {
  const result = await runConversion(request("[1, 2]", { outputFormat: "toml", outputFormatLocked: true }));
  assert.equal(result.parseError, null);
  assert.match(result.outputError ?? "", /TOML requires an object/);
  assert.equal(result.output, "");
});

test("a throwing feature stage does not break the conversion", async () => {
  const result = await runConversion(
    request('{"password":"hunter2"}', { inputFormat: "json", outputFormat: "json" }),
    features({ scanSecrets: fail, collectLosses: fail, isTypeFormat: fail, tryRepair: fail })
  );
  assert.equal(result.output, '{\n  "password": "hunter2"\n}');
  assert.equal(result.secrets, null);
  assert.equal(result.losses, null);
});

test("a throwing describeParseError falls back to the parser message", async () => {
  const result = await runConversion(request("{bad", { inputFormat: "json" }), features({ describeParseError: fail }));
  assert.ok(result.parseError?.message);
  assert.notEqual(result.parseError?.message, "feature bug");
});

test("decode layers: the inner text is detected and the steps are reported", async () => {
  const steps = [{ layer: "base64", label: "Base64" }];
  const result = await runConversion(
    request("ignored"),
    features({ peelLayers: async () => ({ text: "a: 1\nb: 2", steps, format: null }) })
  );
  assert.deepEqual(result.decodeChain, steps);
  assert.equal(result.detectedFormat, "yaml");
  assert.equal(result.output, "a: 1\nb: 2\n");
});

test("decode layers: an input-only inner format makes the output follow JSON", async () => {
  const result = await runConversion(
    request("ignored"),
    features({ peelLayers: async () => ({ text: "x", steps: [], format: "jwt" }) })
  );
  assert.equal(result.detectedFormat, "jwt");
  assert.equal(result.outputFormatUsed, "json");
});

test("decode layers: a throw from peelLayers becomes the parse error", async () => {
  const result = await runConversion(
    request("H4sI"),
    features({
      peelLayers: async () => {
        throw new Error("Decompressed data is over 50 MB");
      },
    })
  );
  assert.equal(result.parseError?.message, "Decompressed data is over 50 MB");
  assert.equal(result.output, "");
});

const repairInfo = { format: "json", fixes: ["Added quotes"], fixCount: 1 };

test("repair runs before parsing when bracketed text was not detected as JSON", async () => {
  let calls = 0;
  const result = await runConversion(
    request("[a, b]"),
    features({
      tryRepair: () => {
        calls++;
        return { value: ["a", "b"], info: repairInfo };
      },
    })
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.repair, repairInfo);
  assert.equal(result.detectedFormat, "json");
  assert.equal(result.outputFormatUsed, "json");
  assert.equal(result.parseError, null);
});

test("repair does not run on valid JSON", async () => {
  const result = await runConversion(request("[1]"), features({ tryRepair: fail }));
  assert.equal(result.repair, null);
  assert.equal(result.output, "[\n  1\n]");
});

test("repair fixes invalid JSON in explicit mode", async () => {
  const result = await runConversion(
    request("{a:1,}", { inputFormat: "json", outputFormat: "json" }),
    features({ tryRepair: () => ({ value: { a: 1 }, info: repairInfo }) })
  );
  assert.equal(result.parseError, null);
  assert.deepEqual(result.repair, repairInfo);
  assert.equal(result.output, '{\n  "a": 1\n}');
});

test("repair is skipped over the size cap", async () => {
  const text = "{" + " ".repeat(LIMITS.repairMaxChars);
  const result = await runConversion(request(text, { inputFormat: "json" }), features({ tryRepair: fail }));
  assert.ok(result.parseError);
  assert.deepEqual(result.skipped, ["repair (over 20 MB)"]);
});

test("secrets are found and redacted on request", async () => {
  const finding = { path: "token", kind: "API token", rule: "prefix" as const, preview: "sk-••••" };
  const options = features({
    scanSecrets: () => [finding],
    redactSecrets: (value) => ({ ...(value as object), token: "[redacted]" }),
  });
  const text = '{"token":"sk-123"}';
  const shown = await runConversion(request(text), options);
  assert.deepEqual(shown.secrets, [finding]);
  assert.match(shown.output, /sk-123/);
  const hidden = await runConversion(request(text, { options: { redactSecrets: true } }), options);
  assert.doesNotMatch(hidden.output, /sk-123/);
  assert.match(hidden.output, /\[redacted\]/);
});

test("a failing redaction never shows the secrets", async () => {
  const result = await runConversion(
    request('{"token":"sk-123"}', { options: { redactSecrets: true } }),
    features({
      scanSecrets: () => [{ path: "token", kind: "API token", rule: "prefix", preview: "sk-••••" }],
      redactSecrets: fail,
    })
  );
  assert.equal(result.output, "");
  assert.ok(result.outputError);
});

test("the secret scan is skipped over the size cap", async () => {
  const result = await runConversion(request("a".repeat(LIMITS.secretsMaxChars + 1)), features({ scanSecrets: fail }));
  assert.equal(result.secrets, null);
  assert.deepEqual(result.skipped, ["secret scan (over 10 MB)"]);
});

test("type formats go to generateTypes and pass on its notes", async () => {
  const result = await runConversion(
    request('[{"a":1}]', { outputFormat: "typescript", outputFormatLocked: true }),
    features({
      isTypeFormat: (format) => format === "typescript",
      generateTypes: async () => ({ output: "type Root = { a: number }[];", notes: ["Inferred from 1 item"] }),
    })
  );
  assert.equal(result.output, "type Root = { a: number }[];");
  assert.deepEqual(result.notes, ["Inferred from 1 item"]);
});

test("losses get the parsed value and both formats", async () => {
  let args: unknown[] = [];
  const losses = { rules: ["All values become strings"], items: [] };
  const result = await runConversion(
    request('{"a":{"b":1}}', { outputFormat: "dotenv", outputFormatLocked: true }),
    features({
      collectLosses: (...received) => {
        args = received;
        return losses;
      },
    })
  );
  assert.deepEqual(args, [{ a: { b: 1 } }, "json", "dotenv"]);
  assert.deepEqual(result.losses, losses);
});

test("line and byte counts", () => {
  assert.equal(countLines(""), 1);
  assert.equal(countLines("a\nb\n"), 3);
  for (const text of ["", "abc", "é", "€", "😀", "a😀bࠀ", "\ud800"]) {
    assert.equal(utf8Length(text), new TextEncoder().encode(text).length, JSON.stringify(text));
  }
});
