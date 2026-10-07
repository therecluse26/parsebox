/**
 * Writes the stress-test inputs in test-data/stress. Run it from the repo root:
 *
 *   npm run stress-data            # layers/, limits/, large/, deep/, edge/
 *   npm run stress-data -- --huge  # also huge/ (about 100 MB, not committed)
 *
 * The data comes from a seeded random generator, so every run writes the same
 * bytes. Encoded files have no trailing line break, like the rest of test-data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import zlib from "node:zlib";
import { encode as msgpackEncode } from "@msgpack/msgpack";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HUGE = process.argv.includes("--huge");
const MB = 1024 * 1024;

// --- Helpers ---

function write(path: string, data: string | Uint8Array) {
  const file = join(ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.length;
  console.log(`${path.padEnd(44)} ${(bytes / 1024).toFixed(1).padStart(9)} KB`);
}

// mulberry32: small, fast and seeded, so the files are the same on every run
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = random(20261007);
const int = (max: number) => Math.floor(rand() * max);
const pick = <T>(list: readonly T[]) => list[int(list.length)];

const gzip = (data: string | Uint8Array) => zlib.gzipSync(data, { level: 9 });
const deflate = (data: string | Uint8Array) => zlib.deflateSync(data, { level: 9 });
const b64 = (data: string | Uint8Array) => Buffer.from(data).toString("base64");
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");
const hex = (data: string | Uint8Array) => Buffer.from(data).toString("hex");
const bits = (data: string | Uint8Array) =>
  Array.from(Buffer.from(data), (byte) => byte.toString(2).padStart(8, "0")).join(" ");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

const FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Ken", "Margaret", "Linus", "Radia", "Donald", "Frances", "Tim"];
const LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Thompson", "Hamilton", "Torvalds", "Perlman", "Knuth"];
const ROLES = ["admin", "editor", "viewer", "owner", "billing"] as const;
const CITIES = ["Zürich", "São Paulo", "Kraków", "東京", "Москва", "Αθήνα", "Reykjavík", "Montréal", "القاهرة", "Lagos"];
const PRODUCTS = ["Widget", "Gadget", "Sprocket", "Gizmo", "Doohickey", "Thingamajig", "Whatsit", "Contraption"];
const EVENTS = ["page_view", "click", "signup", "purchase", "logout", "error", "search", "share"];

function user(id: number) {
  const first = pick(FIRST);
  const last = pick(LAST);
  return {
    id,
    name: `${first} ${last}`,
    email: `${first}.${last}.${id}@example.com`.toLowerCase(),
    role: pick(ROLES),
    active: rand() < 0.8,
    age: 18 + int(70),
    score: Math.round(rand() * 100_000) / 100,
    address: { city: pick(CITIES), zip: String(10_000 + int(89_999)) },
    tags: Array.from({ length: int(4) }, () => pick(["beta", "vip", "legacy", "trial", "staff"])),
    lastLogin: rand() < 0.1 ? null : new Date(1_700_000_000_000 + int(60_000_000) * 1000).toISOString(),
  };
}

function event(id: number) {
  return {
    id: `evt_${id.toString(36).padStart(8, "0")}`,
    type: pick(EVENTS),
    ts: 1_760_000_000 + id * 7 + int(7),
    user: int(50_000),
    props: { path: `/${pick(["home", "docs", "pricing", "blog", "app"])}/${int(1000)}`, ms: int(5000), ok: rand() < 0.95 },
  };
}

const users = (count: number) => Array.from({ length: count }, (_, i) => user(i + 1));

// Grows an array until its JSON passes `bytes`
function arrayOfSize<T>(bytes: number, make: (i: number) => T): T[] {
  const items: T[] = [];
  let size = 2;
  while (size < bytes) {
    const item = make(items.length + 1);
    items.push(item);
    size += JSON.stringify(item).length + 1;
  }
  return items;
}

const csvField = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function csvRows(count: number) {
  const lines = ["order_id,customer,product,quantity,unit_price,note,shipped_at"];
  for (let i = 1; i <= count; i++) {
    const note = pick(["", "Gift, wrap it", 'Said "urgent"', "Leave at door\nRing twice", "n/a", ""]);
    const shipped = rand() < 0.2 ? "" : new Date(1_750_000_000_000 + i * 3_600_000).toISOString();
    lines.push(
      [i, `${pick(FIRST)} ${pick(LAST)}`, pick(PRODUCTS), 1 + int(20), (rand() * 500).toFixed(2), note, shipped]
        .map(csvField)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function xmlCatalog(count: number) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<catalog xmlns:media="http://example.com/media" generated="2026-10-07">'];
  for (let i = 1; i <= count; i++) {
    const name = `${pick(PRODUCTS)} ${i}`;
    parts.push(
      `  <product id="p${i}" sku="SKU-${(i * 7919).toString(16).toUpperCase()}" inStock="${rand() < 0.7}">`,
      `    <name>${xmlEscape(name)}</name>`,
      `    <price currency="${pick(["USD", "EUR", "JPY"])}">${(rand() * 900).toFixed(2)}</price>`,
      `    <description><![CDATA[Fits <all> sizes & shapes. Batch ${i}.]]></description>`,
      `    <media:image href="https://example.com/img/${i}.png"/>`,
      `    <tags>${Array.from({ length: 1 + int(3) }, () => `<tag>${pick(["new", "sale", "eco", "bulk"])}</tag>`).join("")}</tags>`,
      "  </product>"
    );
  }
  parts.push("</catalog>");
  return parts.join("\n") + "\n";
}

function jwt(payload: object) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "stress-test" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", "parsebox-test-only").update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

// --- layers/: encoding chains that auto detect must peel ---

const order = {
  orderId: "ORD-2026-000042",
  customer: { name: "Ada Lovelace", email: "ada@example.com", city: "London" },
  items: [
    { sku: "WID-1", name: "Widget", qty: 2, price: 9.99 },
    { sku: "GAD-7", name: "Gadget ⚙️", qty: 1, price: 24.5 },
  ],
  coupon: null,
  notes: "",
  paid: true,
};
const orderJson = JSON.stringify(order);

write("layers/hex-base64-gzip-json.txt", hex(b64(gzip(orderJson))));
write("layers/binary-hex-base64-gzip-json.txt", bits(hex(b64(gzip(orderJson)))));
write("layers/uri-base64-zlib-json.txt", encodeURIComponent(b64(deflate(orderJson))));
write("layers/base64-gzip-gzip-gzip-json.txt", b64(gzip(gzip(gzip(orderJson)))));
write("layers/base64-hex-base64-gzip-gzip-json.txt", b64(hex(b64(gzip(gzip(orderJson))))));
write("layers/hex-base64-hex-base64-gzip-gzip-json.txt", hex(b64(hex(b64(gzip(gzip(orderJson)))))));
write("layers/base64-gzip-msgpack.txt", b64(gzip(msgpackEncode(order))));
write("layers/hex-zlib-msgpack.txt", hex(deflate(msgpackEncode({ ...order, binary: new Uint8Array([0, 1, 2, 254, 255]) }))));
write("layers/base64-gzip-random-bytes.txt", b64(gzip(Uint8Array.from({ length: 4096 }, () => int(256)))));
write(
  "layers/base64-jwt.txt",
  b64(
    jwt({
      sub: "user-42",
      iss: "https://auth.example.com",
      iat: 1_791_331_200,
      nbf: 1_791_331_200,
      exp: 1_791_334_800,
      scope: ["read", "write"],
      profile: { name: "Ada", roles: ROLES, prefs: { theme: "dark", locale: "en-GB" } },
    })
  )
);

// A JSON string literal that holds a JSON string literal that holds ... the order
let stringly: string = orderJson;
for (let i = 0; i < 3; i++) stringly = JSON.stringify(stringly);
write("layers/json-string-x3.json", stringly + "\n");
let tooStringly: string = orderJson;
for (let i = 0; i < 7; i++) tooStringly = JSON.stringify(tooStringly);
write("layers/json-string-x7.json", tooStringly + "\n");

// --- limits/: inputs at and over the caps in src/config/limits.ts ---

// 60 MB of zeros, gzipped twice: a few hundred bytes that pass the 50 MB decompress cap
write("limits/zip-bomb-60mb.txt", b64(gzip(gzip(new Uint8Array(60 * MB)))));

// About 45 MB of JSON, gzipped twice: just under the decompress cap
{
  const row = JSON.stringify({ id: 0, status: "ok", payload: "x".repeat(200), nested: { a: [1, 2, 3], b: null } });
  const count = Math.floor((45 * MB) / (row.length + 1));
  const big = "[" + Array.from({ length: count }, () => row).join(",") + "]";
  write("limits/gzip-45mb-under-cap.txt", b64(gzip(gzip(big))));
}

// Long enough (128+ bytes) to be reported as corrupt, cut off in the middle
{
  const full = gzip(JSON.stringify(users(20)));
  write("limits/gzip-truncated.txt", b64(full.subarray(0, Math.floor(full.length / 2))));
}
// Gzip magic bytes followed by noise, too short to report: stays Base64
write("limits/gzip-magic-short.txt", b64(Uint8Array.from([0x1f, 0x8b, 0x08, ...Array.from({ length: 40 }, () => int(256))])));

// Just over LIMITS.largeInputChars (250,000): the read-only preview
{
  const list = arrayOfSize(260_000, user);
  write("limits/users-260kb.json", "[\n" + list.map((u) => JSON.stringify(u)).join(",\n") + "\n]\n");
}
// The output for this one passes LIMITS.displayMaxChars: 200 KB of CSV becomes about 800 KB of pretty JSON
write("limits/orders-200kb.csv", csvRows(3_000));

// --- secrets/: the three rules in src/lib/secrets.ts, and values they must skip ---

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const chars = (alphabet: string, length: number) => Array.from({ length }, () => alphabet[int(alphabet.length)]).join("");
const alnum = (length: number) => chars(ALNUM, length);
const hexChars = (length: number) => chars("0123456789abcdef", length);

const testJwt = jwt({ sub: "user-42", iat: 1_791_331_200, exp: 1_791_334_800 });

// Key-name and entropy rules, plus values that must not be flagged
write(
  "secrets/key-names.json",
  json({
    flagged: {
      password: "correct horse battery staple",
      db_password: "hunter2-but-longer",
      clientSecret: "s3cr3t-value-123",
      APIKey: "abc123def456",
      signingKey: "my-signing-key-v2",
      "x-auth-token": "opaque-session-value",
      Authorization: "Bearer opaque-bearer-value",
      passphrase: "open sesame, please",
      nested: { deeper: [{ name: "ok" }, { name: "also ok", private_key: "pk-value-in-an-array" }] },
      randomUnderPlainKey: alnum(40),
      randomBase64: b64(Uint8Array.from({ length: 33 }, () => int(256))),
      databaseUrl: "postgres://admin:Sup3r-S3cret@db.example.com:5432/app",
      logLine: `2026-10-07T10:00:00Z GET /api/me Authorization=${testJwt} status=200`,
    },
    notFlagged: {
      author: "Ada Lovelace",
      max_tokens: 4096,
      password_min_length: 12,
      token_type: "Bearer",
      secret_name: "prod/db/password",
      placeholders: {
        password: "changeme",
        api_key: "<your-api-key>",
        secret: "${DB_SECRET}",
        token: "{{ .Values.token }}",
        auth: "****",
        client_secret: "xxxx-xxxx-xxxx",
        access_key: "",
        privateKey: "REDACTED",
      },
      awsDocsExample: "AKIAIOSFODNN7EXAMPLE",
      uuid: "3f6c1b2e-8a4d-4c1e-9b7a-2d5e6f708192",
      sha256: hexChars(64),
      commitHash: hexChars(40),
      requestId: alnum(40),
      integrity: `sha512-${b64(Uint8Array.from({ length: 64 }, () => int(256)))}`,
      shortRandom: alnum(20),
      longBlob: alnum(300),
      urlWithoutPassword: "https://user@example.com/path",
      urlWithPlaceholder: "redis://default:changeme@cache.example.com:6379",
    },
    // The key-name rule calls these keys metadata, but the entropy rule still flags the random values
    debatable: {
      next_page_token: alnum(40),
      jwtSignature: testJwt.split(".")[2],
    },
  })
);

// The same kinds in dotenv, where every value is a string under an UPPER_CASE key
write(
  "secrets/app.env",
  [
    "# Secrets in dotenv",
    "APP_NAME=parsebox",
    "DATABASE_URL=postgres://app:Sup3r-S3cret@db.example.com:5432/app",
    "SESSION_SECRET=keyboard-cat-but-longer",
    `API_KEY=${alnum(40)}`,
    `JWT=${testJwt}`,
    "SMTP_PASSWORD='quoted pass with spaces'",
    "STRIPE_KEY=${STRIPE_KEY_FROM_VAULT}",
    "TOKEN_TTL=3600",
    "",
  ].join("\n")
);

// Plain text: only the prefix rule runs on a root string
write(
  "secrets/server-log.txt",
  [
    "2026-10-07 10:00:01 INFO  connecting to postgres://app:Sup3r-S3cret@db.example.com:5432/app",
    `2026-10-07 10:00:02 DEBUG request headers: Authorization: Bearer ${testJwt}`,
    "2026-10-07 10:00:03 INFO  password=hunter2 (the key-name rule does not run on text)",
    "2026-10-07 10:00:04 INFO  done",
    "",
  ].join("\n")
);

// One token for each prefix rule. GitHub push protection blocks some of these shapes even
// when fake, so the committed file is Base64 of gzip: auto detect peels it, then scans it.
{
  const pem = (kind: string) =>
    `-----BEGIN ${kind}PRIVATE KEY-----\n${b64(Uint8Array.from({ length: 192 }, () => int(256))).replace(/.{64}/g, "$&\n")}\n-----END ${kind}PRIVATE KEY-----`;
  const tokens = {
    rsaPrivateKey: pem("RSA "),
    opensshPrivateKey: pem("OPENSSH "),
    aws: `AKIA${chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 16)}`,
    githubClassic: `ghp_${alnum(36)}`,
    githubFineGrained: `github_pat_${chars(ALNUM + "_", 82)}`,
    gitlab: `glpat-${alnum(20)}`,
    slackBot: `xoxb-${chars("0123456789", 12)}-${chars("0123456789", 12)}-${alnum(24)}`,
    slackApp: `xapp-1-${alnum(30)}`,
    slackWebhook: `https://hooks.slack.com/services/T${alnum(8)}/B${alnum(8)}/${alnum(24)}`,
    stripeLive: `sk_live_${alnum(24)}`,
    googleApiKey: `AIza${alnum(35)}`,
    googleOauthSecret: `GOCSPX-${alnum(28)}`,
    anthropic: `sk-ant-api03-${chars(ALNUM + "-_", 93)}AA`,
    openaiProject: `sk-proj-${alnum(48)}`,
    openaiLegacy: `sk-${alnum(48)}`,
    npm: `npm_${alnum(36)}`,
    pypi: `pypi-AgEIcHlwaS5vcmc${alnum(60)}`,
    sendgrid: `SG.${alnum(22)}.${alnum(43)}`,
    twilio: `SK${hexChars(32)}`,
    discordWebhook: `https://discord.com/api/webhooks/${chars("0123456789", 18)}/${alnum(68)}`,
    discordBot: `discord bot token: M${alnum(23)}.${alnum(6)}.${alnum(27)}`,
    shopify: `shpat_${hexChars(32)}`,
    digitalocean: `dop_v1_${hexChars(64)}`,
    huggingFace: `hf_${chars("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 34)}`,
    atlassian: `ATATT3${alnum(180)}`,
    linear: `lin_api_${alnum(40)}`,
    postman: `PMAK-${hexChars(24)}-${hexChars(34)}`,
    databricks: `dapi${hexChars(32)}`,
    grafana: `glsa_${alnum(32)}_${hexChars(8)}`,
    newRelic: `NRAK-${chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 27)}`,
    vault: `hvs.${alnum(95)}`,
    age: `AGE-SECRET-KEY-1${chars("023456789ACDEFGHJKLMNPQRSTUVWXYZ", 58)}`,
    azureStorage: `DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${alnum(86)}==;EndpointSuffix=core.windows.net`,
    jwt: testJwt,
    urlPassword: "mongodb+srv://root:Sup3r-S3cret@cluster0.example.net/db",
  };
  write("secrets/vendor-tokens-base64-gzip.txt", b64(gzip(json({ note: "Fake tokens for ParseBox tests", tokens }))));
}

// Over LIMITS.secretsMaxFindings (200): 300 password fields
write(
  "secrets/300-passwords.json",
  json(Array.from({ length: 300 }, (_, i) => ({ service: `svc-${i}`, username: `user${i}`, password: `not-a-real-password-${i}` })))
);

// --- large/: big payloads, under the caps ---

write("large/users-1mb.min.json", JSON.stringify(arrayOfSize(1 * MB, user)) + "\n");
write("large/events-1mb.jsonl", arrayOfSize(1 * MB, event).map((e) => JSON.stringify(e)).join("\n") + "\n");
write("large/orders-1mb.csv", csvRows(15_000));
write("large/catalog-1mb.xml", xmlCatalog(3_000));
write(
  "large/wide-object-20k-keys.json",
  json(Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`key_${i.toString(36)}`, i % 3 ? i : `value ${i}`])))
);
write("large/long-string-1mb.json", json({ id: 1, blob: Array.from({ length: MB }, () => "abcdefghij"[int(10)]).join(""), after: true }));
write("large/base64-gzip-users-5mb.txt", b64(gzip(JSON.stringify(arrayOfSize(5 * MB, user)))));
{
  // Broken JSON: single quotes, trailing commas, comments and unquoted keys, about 500 KB
  const broken = arrayOfSize(500_000, user)
    .map((u) => `  {id: ${u.id}, 'name': '${u.name}', "email": "${u.email}", "active": ${u.active}, /* ok */ "tags": [${u.tags.map((t) => `'${t}'`).join(", ")},],}`)
    .join(",\n");
  write("large/broken-500kb.json", `[\n${broken},\n]\n`);
}

// --- deep/: 1,000 levels, far past real data, under the stack limits of the writers ---

write("deep/array-1k.json", "[".repeat(1_000) + '"bottom"' + "]".repeat(1_000) + "\n");
write("deep/object-1k.json", '{"a":'.repeat(1_000) + '"bottom"' + "}".repeat(1_000) + "\n");
{
  let mixed = '{"leaf":true}';
  for (let i = 0; i < 1_000; i++) mixed = i % 2 ? `{"level${i}":${mixed},"n":${i}}` : `[${i},${mixed}]`;
  write("deep/mixed-1k.json", mixed + "\n");
}
write("deep/xml-1k.xml", "<n>".repeat(1_000) + "bottom" + "</n>".repeat(1_000) + "\n");
write(
  "deep/yaml-300.yaml",
  Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}level${i}:`).join("\n") + `\n${"  ".repeat(300)}value: bottom\n`
);
write("deep/toml-dotted-1k.toml", `${Array.from({ length: 1_000 }, () => "a").join(".")} = "bottom"\n`);
write("deep/querystring-500.txt", `${"a" + "[b]".repeat(500)}=bottom&x=1`);

// --- edge/: values that are hard to keep exact ---

write(
  "edge/unicode-stress.json",
  `{
  "astral": "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𝟘𝟙𝟚 🀄 🂡",
  "zwjEmoji": "👩‍👩‍👧‍👦 🏳️‍🌈 🧑🏽‍💻 👍🏿",
  "combining": "e\\u0301 = é, Z̴̡̛͎̈́a̷̢͚̐l̶̨̛͓g̵̱̈́ő̸̰",
  "rtl": "مرحبا بالعالم \\u200f שלום עולם",
  "cjk": "日本語 中文 한국어",
  "zeroWidth": "a\\u200bb\\u200cc\\u200dd\\ufeffe",
  "lineSeparators": "a\\u2028b\\u2029c",
  "controlChars": "nul:\\u0000 bel:\\u0007 esc:\\u001b del:\\u007f",
  "loneSurrogates": "high:\\ud800 low:\\udc00 reversed:\\udc00\\ud800",
  "escapedAstral": "\\ud83d\\ude80",
  "bidiOverride": "\\u202eabc\\u202c",
  "\\u0000nulKey": 1,
  "": "empty key",
  "  ": "spaces key",
  "key.with.dots": "dots",
  "key[with]brackets": "brackets",
  "key=with&equals": "query characters",
  "🚀": "emoji key"
}
`
);
write(
  "edge/numbers-stress.json",
  `{
  "maxSafe": 9007199254740991,
  "maxSafePlusOne": 9007199254740992,
  "maxSafePlusTwo": 9007199254740993,
  "int64Max": 9223372036854775807,
  "uint64Max": 18446744073709551615,
  "longInteger": 123456789012345678901234567890123456789,
  "negativeZero": -0,
  "negativeZeroFloat": -0.0,
  "tinyExponent": 1e-400,
  "hugeExponent": 1e400,
  "minDouble": 5e-324,
  "maxDouble": 1.7976931348623157e308,
  "longFraction": 0.1000000000000000055511151231257827,
  "trailingZeros": 1.50000,
  "upperExponent": 6.022E+23,
  "manyDigits": 3.14159265358979323846264338327950288419716939937510,
  "intAsFloat": 1.0,
  "numericStrings": ["007", "1e3", "0x1F", "NaN", "Infinity", "-0", " 42 "]
}
`
);
write(
  "edge/prototype-keys.json",
  `{
  "__proto__": { "polluted": true },
  "constructor": { "prototype": { "polluted": true } },
  "prototype": "plain value",
  "hasOwnProperty": "shadowed",
  "toString": "shadowed",
  "valueOf": 0,
  "duplicate": "first",
  "duplicate": "second",
  "nested": { "__proto__": [1, 2, 3] }
}
`
);
write("edge/bom-and-crlf.json", "﻿" + json(order).replace(/\n/g, "\r\n"));
write(
  "edge/yaml-type-traps.yaml",
  `# Values that YAML 1.1 parsers turn into other types
country: NO
answer: yes
off_switch: off
version: 1.10
octal_like: 0777
sexagesimal: 1:30
date_like: 2026-10-07
time_like: 2026-10-07T10:00:00Z
null_tilde: ~
empty:
leading_zero_zip: 02134
dotted_version: 1.2.3
hex_like: 0x1F
infinity: .inf
not_a_number: .NaN
key with: colon in key
"quoted: key": value
list_of_bools: [y, n, on, off, true, false]
anchor: &shared { a: 1, b: [x, y] }
alias: *shared
merged:
  <<: *shared
  c: 3
`
);

// --- huge/: only with --huge (git ignores this folder) ---

if (HUGE) {
  // Over LIMITS.secretsMaxChars (10,000,000): the secret scan is skipped
  write("huge/users-12mb.json", JSON.stringify(arrayOfSize(12 * MB, user)) + "\n");
  write("huge/events-25mb.jsonl", arrayOfSize(25 * MB, event).map((e) => JSON.stringify(e)).join("\n") + "\n");
  write("huge/orders-30mb.csv", csvRows(450_000));
  write("huge/catalog-20mb.xml", xmlCatalog(60_000));
  // Over LIMITS.repairMaxChars (20,000,000): repair is skipped. One missing comma breaks it (JSON5 too).
  write("huge/broken-21mb.json", JSON.stringify(arrayOfSize(21 * MB, user)).replace("},{", "}{") + "\n");
  // About 40 MB of varied JSON behind Base64 and gzip
  write("huge/base64-gzip-users-40mb.txt", b64(gzip(JSON.stringify(arrayOfSize(40 * MB, user)))));
}
