import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanSecrets,
  redactSecrets,
  formatPath,
  parsePath,
  splitKeyWords,
  isPlaceholder,
  isRandomLooking,
} from "../src/lib/secrets.ts";
import { LIMITS } from "../src/config/limits.ts";

// Every token is built at runtime from a seeded generator, so no secret-looking
// literal sits in the repo for scanners to flag.
let seed = 12345;
function gen(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += alphabet[(seed >>> 8) % alphabet.length];
  }
  return out;
}
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const ALNUM = UPPER + LOWER + DIGITS;
const WORD = ALNUM + "_";
const HEX = "0123456789abcdef";
const alnum = (n: number) => gen(ALNUM, n);
const hex = (n: number) => gen(HEX, n);

const pem =
  ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ") +
  "\n" +
  gen(ALNUM + "+/", 64) +
  "\n" +
  gen(ALNUM + "+/", 64) +
  "\n" +
  ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");

const jwt =
  "eyJ" + gen(WORD + "-", 30) + "." + "eyJ" + gen(WORD + "-", 60) + "." + gen(WORD + "-", 43);

// [kind, token]: one sample per prefix rule
const SAMPLES: [string, string][] = [
  ["private key", pem],
  ["aws access key", "AKIA" + gen(UPPER + "234567", 16)],
  ["aws access key", "ASIA" + gen(UPPER + "234567", 16)],
  ["github token", "ghp_" + alnum(36)],
  ["github token", "gho_" + alnum(36)],
  ["github token", "ghu_" + alnum(36)],
  ["github token", "ghs_" + alnum(36)],
  ["github token", "ghr_" + alnum(36)],
  ["github token", "github_pat_" + gen(WORD, 82)],
  ["gitlab token", "glpat-" + gen(WORD + "-", 20)],
  ["slack token", "xoxb-" + gen(DIGITS, 12) + "-" + gen(DIGITS, 13) + "-" + alnum(24)],
  ["slack token", "xoxp-" + gen(DIGITS, 12) + "-" + gen(DIGITS, 12) + "-" + alnum(32)],
  ["slack token", "xapp-1-" + gen(UPPER + DIGITS, 11) + "-" + gen(DIGITS, 13) + "-" + hex(64)],
  ["slack webhook url", "https://hooks.slack.com/services/T" + gen(UPPER + DIGITS, 8) + "/B" + gen(UPPER + DIGITS, 8) + "/" + alnum(24)],
  ["stripe live key", "sk_" + "live_" + alnum(24)],
  ["stripe live key", "rk_" + "live_" + alnum(24)],
  ["google api key", "AIza" + gen(WORD + "-", 35)],
  ["google oauth secret", "GOCSPX-" + gen(WORD + "-", 28)],
  ["anthropic api key", "sk-ant-" + "api03-" + gen(WORD + "-", 93) + "AA"],
  ["openai api key", "sk-proj-" + gen(WORD + "-", 120)],
  ["openai api key", "sk-" + alnum(48)],
  ["npm token", "npm_" + alnum(36)],
  ["pypi token", "pypi-" + "AgEIcHlwaS5vcmc" + gen(WORD + "-", 60)],
  ["sendgrid api key", "SG." + gen(WORD + "-", 22) + "." + gen(WORD + "-", 43)],
  ["twilio api key", "SK" + hex(32)],
  ["discord webhook url", "https://discord.com/api/webhooks/" + gen(DIGITS, 18) + "/" + gen(WORD + "-", 68)],
  ["discord bot token", "DISCORD_TOKEN=" + "M" + alnum(25) + "." + alnum(6) + "." + alnum(30)],
  ["shopify token", "shpat_" + hex(32)],
  ["digitalocean token", "dop_v1_" + hex(64)],
  ["hugging face token", "hf_" + gen(UPPER + LOWER, 34)],
  ["atlassian token", "ATATT3" + gen(WORD + "-", 186)],
  ["linear api key", "lin_api_" + alnum(40)],
  ["postman api key", "PMAK-" + hex(24) + "-" + hex(34)],
  ["databricks token", "dapi" + hex(32)],
  ["grafana token", "glsa_" + alnum(32) + "_" + hex(8)],
  ["new relic key", "NRAK-" + gen(UPPER + DIGITS, 27)],
  ["vault token", "hvs." + gen(WORD + "-", 95)],
  ["age secret key", "AGE-SECRET-KEY-1" + gen("QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L", 58)],
  ["azure storage key", "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=" + gen(ALNUM + "+/", 86) + "==;EndpointSuffix=core.windows.net"],
  ["jwt", jwt],
  ["url with password", "postgres://admin:" + alnum(14) + "@db.internal:5432/app"],
];

for (const [kind, token] of SAMPLES) {
  test(`prefix rule: ${kind} (${token.slice(0, 8)}…)`, () => {
    for (const value of [token, { config: { value: `log line before ${token} and after` } }]) {
      const findings = scanSecrets(value);
      assert.equal(findings.length, 1, JSON.stringify(findings));
      assert.equal(findings[0].kind, kind);
      assert.equal(findings[0].rule, "prefix");
      assert.equal(findings[0].path, typeof value === "string" ? "" : "config.value");
      // The preview never holds the secret
      assert.ok(!findings[0].preview.includes(token.slice(4, -4)) || token.length < 12);
      assert.ok(findings[0].preview.includes("•") || kind === "private key");
    }
  });
}

test("previews: tokens show 4+4, passwords and pem keys show none of the secret", () => {
  const token = "ghp_" + alnum(36);
  assert.equal(scanSecrets(token)[0].preview, token.slice(0, 4) + "••••" + token.slice(-4));
  assert.equal(scanSecrets(pem)[0].preview, "-----BEGIN RSA PRIVATE KEY-----");
  const password = alnum(20);
  assert.equal(scanSecrets("mysql://root:" + password + "@localhost/db")[0].preview, "mysql://root:••••@");
  assert.equal(scanSecrets({ password })[0].preview, "••••");
  assert.equal(scanSecrets({ api_key: "short1234" })[0].preview, "••••");
});

test("prefix rules reject documentation examples and placeholder url passwords", () => {
  assert.deepEqual(scanSecrets("AKIA" + "IOSFODNN7" + "EXAMPLE"), []);
  assert.deepEqual(scanSecrets("postgres://user:password@localhost/db"), []);
  assert.deepEqual(scanSecrets("https://user:${DB_PASS}@host/db"), []);
  assert.deepEqual(scanSecrets("https://example.com:8080/path?x=1"), []);
  // Discord bot tokens need the word nearby
  assert.deepEqual(scanSecrets("M" + alnum(25) + "." + alnum(6) + "." + alnum(30)), []);
});

test("plain text: two secrets in one line", () => {
  const a = "ghp_" + alnum(36);
  const b = "AKIA" + gen(UPPER + "234567", 16);
  const findings = scanSecrets(`export GH=${a} AWS=${b} # done`);
  assert.deepEqual(
    findings.map((f) => [f.path, f.kind]),
    [
      ["", "github token"],
      ["", "aws access key"],
    ],
  );
});

test("overlapping matches: the specific rule wins over the url rule", () => {
  const token = "ghp_" + alnum(36);
  const findings = scanSecrets(`https://x-access-token:${token}@github.com/org/repo.git`);
  assert.deepEqual(findings.map((f) => f.kind), ["github token"]);
});

test("key words: snake, kebab, camel and acronyms", () => {
  assert.deepEqual(splitKeyWords("client_secret"), ["client", "secret"]);
  assert.deepEqual(splitKeyWords("x-api-key"), ["x", "api", "key"]);
  assert.deepEqual(splitKeyWords("awsSecretAccessKey"), ["aws", "secret", "access", "key"]);
  assert.deepEqual(splitKeyWords("APIKey"), ["api", "key"]);
  assert.deepEqual(splitKeyWords("@_password"), ["password"]);
});

test("key-name: suspicious keys", () => {
  const value = {
    db: { password: "hunter2!x" },
    DB_PASS: "pa55word!",
    clientSecret: "a1b2c3d4e5f6",
    "x-api-key": "abcdefgh1234",
    apiKey: "abcdefgh5678",
    private_key: "line1line2line3",
    auth_token: "opaque-value-1",
    Authorization: "Basic dXNlcjpwYXNz",
    credentials: "user:hunter22",
    secret_key_base: "0123456789abcdef0123",
    signingKey: "signing-key-value",
    passphrase: "correct horse battery",
  };
  const findings = scanSecrets(value);
  assert.deepEqual(
    findings.map((f) => [f.path, f.kind, f.rule]),
    [
      ["db.password", "password field", "key-name"],
      ["DB_PASS", "password field", "key-name"],
      ["clientSecret", "secret field", "key-name"],
      ['["x-api-key"]', "api key field", "key-name"],
      ["apiKey", "api key field", "key-name"],
      ["private_key", "private key field", "key-name"],
      ["auth_token", "auth field", "key-name"],
      ["Authorization", "auth field", "key-name"],
      ["credentials", "credential field", "key-name"],
      ["secret_key_base", "secret field", "key-name"],
      ["signingKey", "signing key field", "key-name"],
      ["passphrase", "password field", "key-name"],
    ],
  );
});

test("key-name: false positives stay quiet", () => {
  const value = {
    author: "Jane Doe Smithson",
    authors: ["Jane Doe Smithson"],
    max_tokens: "4096",
    maxTokens: 4096,
    token_count: "12345678",
    tokenCount: 12345678,
    password_min_length: 8,
    passwordMinLength: "8",
    token_type: "Bearer",
    secretName: "my-app-credentials",
    next_page_token: "CAEQAhoMCgoIARIGCgQIBhAB",
    password_reset_url: "https://example.org/reset",
    token_expires_at: "2026-01-01T00:00:00Z",
    has_password: true,
    tokenizer: "cl100k_base_tokenizer",
    keyboard: "us-international-layout",
    key: "user-settings-panel",
    secretary: "Jane Doe Smithson",
    constructor: "not-a-secret-value",
    toString: "not-a-secret-value",
  };
  assert.deepEqual(scanSecrets(value), []);
});

test("key-name: placeholders, empty values, booleans and numbers are ignored", () => {
  const placeholders = [
    "",
    "   ",
    "xxx",
    "xxxxxxxx",
    "****",
    "••••••••",
    "changeme",
    "CHANGEME",
    "null",
    "none",
    "<your-key>",
    "<YOUR_API_KEY>",
    "${DB_PASSWORD}",
    "$DB_PASSWORD",
    "{{ .Values.db.password }}",
    "%API_KEY%",
    "[REDACTED]",
    "your_api_key_here",
    "replace-me-with-a-real-token",
    "example-token-value",
    "00000000",
  ];
  for (const p of placeholders) assert.ok(isPlaceholder(p), `placeholder: ${JSON.stringify(p)}`);
  const value = {
    passwords: placeholders.map((password) => ({ password, api_key: password, client_secret: password })),
    flags: { password: true, token: 12345678, secret: null, api_key: false },
    tooShort: { token: "abc1234", password: "ab" },
  };
  assert.deepEqual(scanSecrets(value), []);
  assert.ok(!isPlaceholder("hunter2!x"));
  assert.ok(!isPlaceholder(alnum(40)));
});

test("key-name: strings in an array under a suspicious key", () => {
  const findings = scanSecrets({ api_keys: ["k-" + alnum(12), "k-" + alnum(12)] });
  assert.deepEqual(findings.map((f) => f.path), ["api_keys[0]", "api_keys[1]"]);
  assert.ok(findings.every((f) => f.kind === "api key field"));
});

test("entropy: random-looking strings, and the documented skips", () => {
  const random = alnum(40);
  assert.ok(isRandomLooking(random));
  const findings = scanSecrets({ data: { blob: random } });
  assert.deepEqual(findings.map((f) => [f.path, f.kind, f.rule]), [["data.blob", "high-entropy string", "entropy"]]);
  assert.equal(findings[0].preview, random.slice(0, 4) + "••••" + random.slice(-4));

  const quiet = {
    // UUIDs and hex hashes are ids, not secrets
    uuid: "3f2b8c1e-9d4a-4b7e-8f6a-1c2d3e4f5a6b",
    value: hex(64),
    commit: hex(40),
    // Random, but under an id-like key
    id: alnum(40),
    request_id: alnum(40),
    // Too short (nanoid), too long (a base64 blob), or not the alphabet
    nanoid: alnum(21),
    blob: alnum(300),
    sentence: "the quick brown fox jumps over 12 lazy dogs again",
    url: "https://example.com/" + alnum(40),
    // Subresource integrity
    integrity: "sha512-" + gen(ALNUM + "+/", 86) + "==",
    // Identifiers: no digits, or low entropy
    name: "getUserAccountSettingsByIdentifierVersion",
    camel: "MyComponent_v2_FinalVersion_2023_Backup",
  };
  assert.deepEqual(scanSecrets(quiet), []);
});

test("entropy: hex under a suspicious key is caught by the key-name rule", () => {
  const findings = scanSecrets({ webhook_secret: hex(64) });
  assert.deepEqual(findings.map((f) => f.rule), ["key-name"]);
});

test("entropy and key-name do not run on plain text", () => {
  assert.deepEqual(scanSecrets(alnum(40)), []);
  assert.deepEqual(scanSecrets("password: hunter22"), []);
});

test("paths: nesting and quoting", () => {
  const token = "ghp_" + alnum(36);
  const value = [
    {},
    {},
    {},
    { token },
    { servers: [{ auth: { "api.key": token, "my key": token, "3": token, "": token } }] },
  ];
  assert.deepEqual(scanSecrets(value).map((f) => f.path), [
    "[3].token",
    "[4].servers[0].auth[\"3\"]",
    '[4].servers[0].auth["api.key"]',
    '[4].servers[0].auth["my key"]',
    '[4].servers[0].auth[""]',
  ]);
  assert.deepEqual(scanSecrets({ "key.with.dot": token }).map((f) => f.path), ['["key.with.dot"]']);
  assert.deepEqual(scanSecrets({ 'quo"te': token }).map((f) => f.path), ['["quo\\"te"]']);
});

test("paths: format and parse round-trip", () => {
  const cases: (string | number)[][] = [
    ["db", "password"],
    [3, "token"],
    ["servers", 0, "auth", "key"],
    ["key.with.dot"],
    ["a", "b.c", 2, 'q"u]o[te', "", "$x", "_y1"],
    ["3", 3],
  ];
  for (const keys of cases) assert.deepEqual(parsePath(formatPath(keys)), keys);
  assert.equal(formatPath(["servers", 0, "auth", "key"]), "servers[0].auth.key");
  assert.equal(parsePath("a[x]"), null);
  assert.equal(parsePath(".a"), null);
});

test("other value shapes: numbers, null, typed arrays, root primitives", () => {
  assert.deepEqual(scanSecrets(null), []);
  assert.deepEqual(scanSecrets(42), []);
  assert.deepEqual(scanSecrets(undefined), []);
  assert.deepEqual(scanSecrets({ data: new Uint8Array(1000), when: new Date() }), []);
  // ini.parse returns objects without a prototype
  const bare = Object.assign(Object.create(null), { password: "hunter2!x" });
  assert.equal(scanSecrets({ section: bare })[0].path, "section.password");
});

test("findings stop at the cap", () => {
  const value = Array.from({ length: 500 }, (_, i) => ({ password: `pw-${i}-value` }));
  const findings = scanSecrets(value);
  assert.equal(findings.length, LIMITS.secretsMaxFindings);
  assert.equal(findings[0].path, "[0].password");
  // Plain text too
  const text = Array.from({ length: 500 }, () => "ghp_" + alnum(36)).join("\n");
  assert.equal(scanSecrets(text).length, LIMITS.secretsMaxFindings);
});

// ---------------------------------------------------------------------------
// redaction

test("redact: structural sharing, input not mutated", () => {
  const token = "ghp_" + alnum(36);
  const input = {
    untouched: { deep: { list: [1, 2, 3] } },
    db: { host: "db.internal", password: "hunter2!x", options: { ssl: true } },
    logs: ["boot ok", `cloned with ${token} at 10:00`, "done"],
    blob: alnum(40),
  };
  const before = structuredClone(input);
  const findings = scanSecrets(input);
  const out = redactSecrets(input, findings) as typeof input;

  assert.deepEqual(input, before);
  assert.notEqual(out, input);
  assert.equal(out.untouched, input.untouched);
  assert.notEqual(out.db, input.db);
  assert.equal(out.db.options, input.db.options);
  assert.equal(out.db.host, "db.internal");
  assert.equal(out.db.password, "[REDACTED]");
  assert.notEqual(out.logs, input.logs);
  assert.deepEqual(out.logs, ["boot ok", "cloned with [REDACTED] at 10:00", "done"]);
  assert.equal(out.blob, "[REDACTED]");
});

test("redact: only the password of a url, only the key of a connection string", () => {
  const password = alnum(14);
  const key = gen(ALNUM + "+/", 86) + "==";
  const input = {
    url: `postgres://admin:${password}@db.internal:5432/app`,
    azure: `AccountName=x;AccountKey=${key};EndpointSuffix=core.windows.net`,
  };
  const out = redactSecrets(input, scanSecrets(input)) as typeof input;
  assert.equal(out.url, "postgres://admin:[REDACTED]@db.internal:5432/app");
  assert.equal(out.azure, "AccountName=x;AccountKey=[REDACTED];EndpointSuffix=core.windows.net");
});

test("redact: plain text with several secrets", () => {
  const a = "ghp_" + alnum(36);
  const b = "AKIA" + gen(UPPER + "234567", 16);
  const text = `GH=${a}\nAWS=${b}\n${pem}\nend`;
  const out = redactSecrets(text, scanSecrets(text));
  assert.equal(out, "GH=[REDACTED]\nAWS=[REDACTED]\n[REDACTED]\nend");
});

test("redact: no findings returns the same value; bad paths are skipped", () => {
  const input = { a: { b: "c" } };
  assert.equal(redactSecrets(input, []), input);
  const out = redactSecrets(input, [
    { path: "a.missing.deep", kind: "x", rule: "key-name", preview: "" },
    { path: "a.b[2]", kind: "x", rule: "key-name", preview: "" },
  ]) as typeof input;
  assert.deepEqual(out, input);
  assert.equal(input.a.b, "c");
});

test("redact: a __proto__ key stays an own property", () => {
  const input = JSON.parse('{"__proto__": {"password": "hunter2!x"}}');
  const out = redactSecrets(input, scanSecrets(input)) as Record<string, Record<string, string>>;
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(out, "__proto__")?.value.password, "[REDACTED]");
  assert.equal(input["__proto__"].password, "hunter2!x");
});

test("redact: past the findings cap, every secret is still redacted", () => {
  const input = Array.from({ length: 500 }, (_, i) => ({ id: i, password: `pw-${i}-value` }));
  const findings = scanSecrets(input);
  assert.equal(findings.length, LIMITS.secretsMaxFindings);
  const out = redactSecrets(input, findings) as typeof input;
  assert.ok(out.every((row) => row.password === "[REDACTED]"));
  assert.ok(input.every((row) => row.password !== "[REDACTED]"));
  assert.equal(out[0].id, 0);
});

// ---------------------------------------------------------------------------
// timing

test("timing: ~20 MB of JSON with many strings", (t) => {
  const rows = [];
  for (let i = 0; i < 45_000; i++) {
    rows.push({
      id: hex(24),
      uuid: "3f2b8c1e-9d4a-4b7e-8f6a-" + hex(12),
      name: "user " + i,
      email: `user${i}@example.com`,
      author: "Jane Doe",
      url: "https://example.com/items/" + i + "?ref=feed",
      description: "a longer description with spaces, numbers 12345 and words to scan",
      token_count: i,
      tags: ["alpha", "beta", "gamma"],
      meta: { created: "2026-01-01T00:00:00Z", sha: hex(40), label: "Label" + i },
    });
  }
  // A few real findings deep in the data
  rows[500].meta = { ...rows[500].meta, password: "hunter2!x" } as typeof rows[0]["meta"];
  rows[40_000].description = "leaked ghp_" + alnum(36) + " here";
  const text = JSON.stringify(rows);
  const value = JSON.parse(text);

  let start = performance.now();
  const findings = scanSecrets(value);
  const scanMs = performance.now() - start;
  start = performance.now();
  redactSecrets(value, findings);
  const redactMs = performance.now() - start;

  t.diagnostic(`json: ${(text.length / 1e6).toFixed(1)} MB, ${rows.length} rows: scan ${scanMs.toFixed(0)} ms, redact ${redactMs.toFixed(1)} ms, ${findings.length} findings`);
  assert.ok(text.length > 19_000_000);
  assert.deepEqual(findings.map((f) => f.path), ["[500].meta.password", "[40000].description"]);
  assert.ok(scanMs < 5000, `scan took ${scanMs} ms`);
});

test("timing: ~20 MB of plain text log lines", (t) => {
  const lines = [];
  for (let i = 0; i < 200_000; i++) {
    lines.push(`2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z INFO GET https://api.example.com/v1/items/${i} 200 ${hex(16)} SKU-${i} task done`);
  }
  lines[150_000] += " key=sk_" + "live_" + alnum(24);
  const text = lines.join("\n");
  let start = performance.now();
  const findings = scanSecrets(text);
  const scanMs = performance.now() - start;
  start = performance.now();
  const out = redactSecrets(text, findings) as string;
  const redactMs = performance.now() - start;
  t.diagnostic(`text: ${(text.length / 1e6).toFixed(1)} MB: scan ${scanMs.toFixed(0)} ms, redact ${redactMs.toFixed(0)} ms`);
  assert.equal(findings.length, 1);
  assert.ok(out.includes("key=[REDACTED]"));
  assert.ok(scanMs < 5000, `scan took ${scanMs} ms`);
});

test("timing: adversarial strings stay linear", (t) => {
  const cases = [
    "eyJ".repeat(2_000_000),
    "eyJ-".repeat(1_500_000),
    ("eyJ" + "a".repeat(20) + ".eyJ" + "b".repeat(40) + "-").repeat(80_000),
    "-----BEGIN PRIVATE KEY-----".repeat(200_000),
    "-----BEGIN PRIVATE KEY-----!".repeat(200_000),
    "a://".repeat(1_000_000) + "b:c",
    ("ab://" + "x".repeat(100) + ":" + "y".repeat(100)).repeat(25_000),
    "sk-ant-api03-".repeat(400_000),
    "AKIA".repeat(1_000_000),
    "discord " + ("M" + "a".repeat(30) + ".").repeat(150_000),
  ];
  for (const text of cases) {
    const start = performance.now();
    scanSecrets(text);
    scanSecrets({ value: text });
    const ms = performance.now() - start;
    t.diagnostic(`${text.slice(0, 12)}… ${(text.length / 1e6).toFixed(1)} MB: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 5000, `${text.slice(0, 20)} took ${ms} ms`);
  }
});
