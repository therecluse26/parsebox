import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodeJwt, peelLayers } from "../src/lib/decodeChain.ts";
import { detectFormat } from "../src/lib/detectFormat.ts";
import { LIMITS } from "../src/config/limits.ts";
import { runConversion } from "../src/lib/convert/pipeline.ts";
import { encode as msgpackEncode } from "@msgpack/msgpack";

const sample = { users: [{ id: 1, name: "Ada", email: "ada@example.com", tags: ["admin", "ops"] }], ok: true };
const json = JSON.stringify(sample);

const b64 = (data: string | Uint8Array) => Buffer.from(data).toString("base64");
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");
const layersOf = (result: { steps: { layer: string }[] }) => result.steps.map((step) => step.layer);

async function assertPeels(input: string, layers: string[], format: string, text?: string) {
  const result = await peelLayers(input);
  assert.deepEqual(layersOf(result), layers);
  assert.equal(result.format, format);
  if (text !== undefined) assert.equal(result.text, text);
  return result;
}

test("base64 → json", async () => {
  await assertPeels(b64(json), ["base64"], "json", json);
});

test("base64 with a trailing newline, 76-column wrapping, base64url and no padding", async () => {
  const long = JSON.stringify({ ...sample, note: "x".repeat(200) });
  await assertPeels(b64(json) + "\n", ["base64"], "json", json);
  const wrapped = b64(long).replace(/.{76}/g, "$&\r\n");
  await assertPeels(wrapped, ["base64"], "json", long);
  await assertPeels(b64url(json), ["base64"], "json", json);
  await assertPeels(b64(long).replace(/=+$/, ""), ["base64"], "json", long);
});

test("base64 → gzip → json", async () => {
  const result = await assertPeels(b64(zlib.gzipSync(json)), ["base64", "gzip"], "json", json);
  assert.deepEqual(
    result.steps.map((step) => step.label),
    ["Base64", "gzip"]
  );
});

test("base64 → zlib → json", async () => {
  for (const level of [1, 6, 9]) {
    await assertPeels(b64(zlib.deflateSync(json, { level })), ["base64", "deflate"], "json", json);
  }
});

test("base64 → gzip → gzip → json", async () => {
  await assertPeels(b64(zlib.gzipSync(zlib.gzipSync(json))), ["base64", "gzip", "gzip"], "json", json);
});

test("hex → json, also with spaces", async () => {
  const hex = Buffer.from(json).toString("hex");
  await assertPeels(hex, ["hex"], "json", json);
  await assertPeels(hex.replace(/../g, "$& ").trim(), ["hex"], "json", json);
  await assertPeels(Buffer.from(zlib.gzipSync(json)).toString("hex"), ["hex", "gzip"], "json", json);
});

test("binary → json", async () => {
  const bits = [...Buffer.from(json)].map((byte) => byte.toString(2).padStart(8, "0")).join(" ");
  await assertPeels(bits, ["binary"], "json", json);
});

test("uri → json", async () => {
  await assertPeels(encodeURIComponent(json), ["uri"], "json", json);
  await assertPeels("hello%20world", ["uri"], "text", "hello world");
});

test("query strings are not uri layers", async () => {
  await assertPeels("a=%7B%7D&b=2", [], "querystring");
  await assertPeels("q=hello+world", [], "querystring");
});

test("json string → json, one step per level", async () => {
  await assertPeels(JSON.stringify(json), ["json-string"], "json", json);
  await assertPeels(JSON.stringify(JSON.stringify(json)), ["json-string", "json-string"], "json", json);
  // A JSON string that is not JSON inside stays a string
  await assertPeels('"[INFO] Server started"', [], "json");
  await assertPeels('"just a string"', [], "json");
});

test("base64 → json string → json", async () => {
  await assertPeels(b64(JSON.stringify(json)), ["base64", "json-string"], "json", json);
});

test("base64 → plain text shows the decoded text", async () => {
  await assertPeels(b64("hello world"), ["base64"], "text", "hello world");
  await assertPeels(b64("Grüße aus Köln, 東京"), ["base64"], "text", "Grüße aus Köln, 東京");
});

const jwtHeader = { alg: "HS256", typ: "JWT" };
const jwtPayload = { sub: "1234567890", name: "Ada", iat: 1_700_000_000, exp: 1_700_003_600 };
const jwt = `${b64url(JSON.stringify(jwtHeader))}.${b64url(JSON.stringify(jwtPayload))}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`;

test("jwt", async () => {
  const result = await assertPeels(jwt, ["jwt"], "json");
  const decoded = JSON.parse(result.text);
  assert.deepEqual(decoded.header, jwtHeader);
  assert.deepEqual(decoded.payload, jwtPayload);
  assert.equal(decoded.signature, "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  // An unsigned token has an empty signature
  await assertPeels(`${b64url('{"alg":"none"}')}.${b64url('{"a":1}')}.`, ["jwt"], "json");
  // A header without "alg" is not a JWT
  await assertPeels(`${b64url('{"typ":"JWT"}')}.${b64url('{"a":1}')}.abc`, [], "text");
});

test("decodeJwt returns header, payload, signature and readable dates", () => {
  assert.deepEqual(decodeJwt(` ${jwt}\n`), {
    header: jwtHeader,
    payload: jwtPayload,
    signature: "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    dates: { iat: "2023-11-14T22:13:20.000Z", exp: "2023-11-14T23:13:20.000Z" },
  });
  const noDates = decodeJwt(`${b64url('{"alg":"none"}')}.${b64url('{"a":1}')}.`) as object;
  assert.equal("dates" in noDates, false);
});

test("decodeJwt errors", () => {
  assert.throws(() => decodeJwt("abc.def"), /3 parts separated by dots, but this has 2/);
  assert.throws(() => decodeJwt("a.b.c.d"), /but this has 4/);
  assert.throws(() => decodeJwt(`e*J.${b64url("{}")}.x`), /header is not valid base64url/);
  assert.throws(() => decodeJwt(`${b64url("{}")}.${b64url("not json")}.x`), /payload is not JSON/);
  assert.throws(() => decodeJwt(`${b64url("{}")}.${b64url("{}")}.x*y`), /signature is not valid base64url/);
});

test("depth limit", async () => {
  let text = json;
  for (let i = 0; i < 7; i++) text = b64(text);
  const result = await peelLayers(text);
  assert.equal(result.steps.length, LIMITS.decodeMaxDepth);
  assert.equal(result.format, "base64");

  const shallow = await peelLayers(text, { maxDepth: 2 });
  assert.equal(shallow.steps.length, 2);

  // The encoding and its compression count together: base64 + gzip does not fit in one layer
  const gzipped = b64(zlib.gzipSync(json));
  const one = await peelLayers(gzipped, { maxDepth: 1 });
  assert.deepEqual(layersOf(one), []);
  assert.equal(one.text, gzipped);
});

// A gzip stream that expands to `megabytes` MB of zeros, built from one repeated
// sync-flushed deflate block, so the test never holds the expanded data
function gzipBomb(megabytes: number): Buffer {
  const block = zlib.deflateRawSync(Buffer.alloc(1024 * 1024), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff]);
  const end = zlib.deflateRawSync(Buffer.alloc(0));
  const trailer = Buffer.alloc(8); // CRC and size are never reached
  return Buffer.concat([header, ...Array(megabytes).fill(block), end, trailer]);
}

test("zip-bomb cap: a small cap stops a crafted payload", async () => {
  const bomb = b64(gzipBomb(8));
  await assert.rejects(peelLayers(bomb, { decompressMaxBytes: 1024 * 1024 }), /gzip data expands to more than 1 MB/);
});

test("zip-bomb cap: 2 GB of zeros stops at the default cap without allocating it", async () => {
  const bomb = gzipBomb(2048);
  const before = process.memoryUsage().arrayBuffers;
  const start = performance.now();
  await assert.rejects(peelLayers(b64(bomb)), /gzip data expands to more than 50 MB/);
  const grew = process.memoryUsage().arrayBuffers - before;
  assert.ok(grew < 512 * 1024 * 1024, `grew ${grew} bytes`);
  assert.ok(performance.now() - start < 10_000);
});

test("corrupt compressed data: long data is reported, short chance matches are skipped", async () => {
  const big = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, value: Math.random() })));
  const truncated = zlib.gzipSync(big).subarray(0, 400);
  await assert.rejects(peelLayers(b64(truncated)), /gzip data is corrupt or truncated/);
  // Starts with the zlib magic bytes 78 9c by chance
  await assertPeels("eJwAAAAAAAAAAAAAAAAAAAAA", [], detectFormat("eJwAAAAAAAAAAAAAAAAAAAAA"));
});

test("binary (non-UTF-8) bytes stop the chain", async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 0x80) & 0xff);
  const encoded = b64(bytes);
  const result = await assertPeels(encoded, [], "base64", encoded);
  assert.equal(result.text, encoded);
});

test("gzip of binary peels to the raw bytes, and gzip of MessagePack to MessagePack", async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 0x80) & 0xff);
  await assertPeels(b64(zlib.gzipSync(bytes)), ["base64", "gzip"], "base64", b64(bytes));
  const packed = msgpackEncode({ id: 1, tags: ["a", "b"], blob: new Uint8Array([0xff, 0x00]) });
  await assertPeels(b64(zlib.gzipSync(packed)), ["base64", "gzip"], "msgpack", b64(packed));
});

test("the pipeline shows gzip of MessagePack as JSON and gzip of binary as Base64", async () => {
  const request = { id: 1, inputFormat: "auto", outputFormat: "text", outputFormatLocked: false, options: { redactSecrets: false } };
  const packed = b64(zlib.gzipSync(msgpackEncode({ id: 1, tags: ["a", "b"] })));
  const fromPacked = await runConversion({ ...request, text: packed });
  assert.equal(fromPacked.outputFormatUsed, "json");
  assert.deepEqual(JSON.parse(fromPacked.output), { id: 1, tags: ["a", "b"] });

  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 0x80) & 0xff);
  const fromBinary = await runConversion({ ...request, text: b64(zlib.gzipSync(bytes)) });
  assert.equal(fromBinary.outputFormatUsed, "base64");
  assert.equal(fromBinary.output, b64(bytes));
});

test("MessagePack stays a terminal format", async () => {
  await assertPeels("gaFhAQ==", [], "msgpack");
  await assertPeels("g6JpZAGkbmFtZaNBZGGmYWN0aXZlww==", [], "msgpack");
});

test("plain input produces no steps", async () => {
  await assertPeels(json, [], "json", json);
  await assertPeels("id,name\n1,Ada\n2,Grace", [], "csv");
  await assertPeels("name: Ada\nrole: admin", [], "yaml");
  await assertPeels("<a><b>1</b></a>", [], "xml");
  await assertPeels("", [], "text", "");
});

test("short words and numbers are not layers", async () => {
  for (const word of ["hello", "cafe", "deadbeef", "Test", "test", "file", "city", "2026", "42", "1234567890123456", "emphasis", "getElementById", "Internationalization"]) {
    const result = await peelLayers(word);
    assert.deepEqual(layersOf(result), [], word);
    assert.equal(result.format, detectFormat(word), word);
  }
});

// --- Timing on ~20 MB ---

function bigJson(targetBytes: number): string {
  const rows: string[] = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const row = JSON.stringify({ id: i, key: Math.random().toString(16).slice(2), score: Math.random(), name: `user ${i}` });
    rows.push(row);
    size += row.length + 1;
  }
  return `[${rows.join(",")}]`;
}

test("timing: ~20 MB base64(gzip(json))", async (t) => {
  // Random hex compresses about 2:1, so 20 MB of Base64 stays under the 50 MB cap
  const inner = bigJson(44 * 1024 * 1024);
  const encoded = b64(zlib.gzipSync(inner, { level: 1 }));
  const start = performance.now();
  const result = await peelLayers(encoded);
  const elapsed = performance.now() - start;
  assert.deepEqual(layersOf(result), ["base64", "gzip"]);
  assert.equal(result.format, "json");
  assert.equal(result.text.length, inner.length);
  t.diagnostic(
    `${(encoded.length / 1e6).toFixed(1)} MB base64 → ${(inner.length / 1e6).toFixed(1)} MB json: ${elapsed.toFixed(0)} ms (includes detectFormat of the json)`
  );
  assert.ok(elapsed < 15_000);
});

test("timing: ~20 MB plain json costs about one detectFormat", async (t) => {
  const text = bigJson(20 * 1024 * 1024);
  const detectStart = performance.now();
  detectFormat(text);
  const detectMs = performance.now() - detectStart;
  const start = performance.now();
  const result = await peelLayers(text);
  const peelMs = performance.now() - start;
  assert.deepEqual(result.steps, []);
  assert.equal(result.format, "json");
  t.diagnostic(`${(text.length / 1e6).toFixed(1)} MB json: detectFormat ${detectMs.toFixed(0)} ms, peelLayers ${peelMs.toFixed(0)} ms`);
  assert.ok(peelMs < detectMs * 2 + 100);
});
