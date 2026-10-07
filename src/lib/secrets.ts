import type { SecretFinding } from "./convert/types.ts";
import { LIMITS } from "../config/limits.ts";

/**
 * Secret detection: find values that look like API keys, tokens, passwords or
 * private keys in the parsed value. Runs fully in the browser, no network, so
 * nothing is verified: every finding is a "possible" secret.
 *
 * Three rules, checked in this order for each string (the first that fires wins):
 *
 * 1. prefix: known token formats (AWS, GitHub, Stripe, JWT, PEM keys...). Matches
 *    anywhere in a string, so a token inside a log line or a URL is found. Plain
 *    text input (a root string) uses only this rule.
 * 2. key-name: a string under a key such as `password`, `client_secret` or
 *    `apiKey`. Keys are split into words (snake, kebab, camel case) and matched as
 *    whole words, so `author`, `max_tokens` and `password_min_length` do not count.
 *    Placeholders (`changeme`, `<your-key>`, `${VAR}`, `****`...) are ignored.
 * 3. entropy: a random-looking string with no other signal. See `isRandomLooking`.
 *
 * Cost: one pass over the value. Each string is first checked against its length
 * and one combined regex of literal prefixes, so most strings cost almost nothing.
 * Every regex starts at a fixed prefix and uses bounded quantifiers, so matching
 * stays linear. Key classifications are cached, since the same keys repeat.
 */

const BULLETS = "••••";
const REDACTED = "[REDACTED]";

interface PrefixRule {
  kind: string;
  /** Literal substrings; the regex runs only when one of them is in the string */
  anchors: string[];
  /**
   * Global. Every variable-length part either ends the regex or is followed by an
   * optional group, so a failed suffix never makes the engine rescan a long run.
   */
  re: RegExp;
  /** Group 1 is context before the secret and group 2 is the secret; otherwise the whole match */
  context?: boolean;
  /** Passwords: the preview shows no characters of the secret */
  password?: boolean;
  /** Rejects a match, for example a documentation example or a placeholder */
  accept?: (secret: string, match: RegExpExecArray) => boolean;
  preview?: (match: RegExpExecArray) => string;
}

// Patterns follow the high-confidence rules of gitleaks (MIT License, https://github.com/gitleaks/gitleaks).
// The order is the priority when two matches overlap: specific formats first, generic shapes last.
const PREFIX_RULES: PrefixRule[] = [
  {
    kind: "private key",
    anchors: ["PRIVATE KEY"],
    // Header, body (base64 and "Proc-Type: 4,ENCRYPTED" lines; a single "-" but never "--"), then the footer if present
    re: /-----BEGIN[ A-Z0-9]{0,30}PRIVATE KEY(?: BLOCK)?-----(?:[A-Za-z0-9+/=\s:,.\\]|-(?!-)){0,16384}(?:-----END[ A-Z0-9]{0,30}PRIVATE KEY(?: BLOCK)?-----)?/g,
    preview: (m) => m[0].slice(0, m[0].indexOf("-----", 10) + 5),
  },
  {
    kind: "aws access key",
    anchors: ["AKIA", "ASIA", "ABIA", "ACCA", "A3T"],
    re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g,
    // AWS documentation keys end in EXAMPLE
    accept: (s) => !s.endsWith("EXAMPLE"),
  },
  { kind: "github token", anchors: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"], re: /\bgh[pousr]_[A-Za-z0-9]{36,251}\b/g },
  { kind: "github token", anchors: ["github_pat_"], re: /\bgithub_pat_\w{82}\b/g },
  { kind: "gitlab token", anchors: ["glpat-", "glptt-", "glrt-", "gldt-"], re: /\bgl(?:pat|ptt|rt|dt)-[\w-]{20,250}/g },
  { kind: "slack token", anchors: ["xox"], re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,250}/g },
  { kind: "slack token", anchors: ["xapp-"], re: /\bxapp-\d-[A-Za-z0-9-]{20,250}/g },
  {
    kind: "slack webhook url",
    anchors: ["hooks.slack.com"],
    re: /(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{20,200}/g,
  },
  { kind: "stripe live key", anchors: ["_live_"], re: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,247}/g },
  { kind: "google api key", anchors: ["AIza"], re: /\bAIza[\w-]{35}/g },
  { kind: "google oauth secret", anchors: ["GOCSPX-"], re: /\bGOCSPX-[\w-]{28}/g },
  { kind: "anthropic api key", anchors: ["sk-ant-"], re: /\bsk-ant-[a-z]{2,8}\d{2}-[\w-]{80,120}/g },
  { kind: "openai api key", anchors: ["sk-proj-", "sk-svcacct-", "sk-admin-"], re: /\bsk-(?:proj|svcacct|admin)-[\w-]{40,250}/g },
  { kind: "openai api key", anchors: ["sk-"], re: /\bsk-[A-Za-z0-9]{48}\b/g },
  { kind: "npm token", anchors: ["npm_"], re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "pypi token", anchors: ["pypi-AgEIcHlwaS5vcmc"], re: /\bpypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/g },
  { kind: "sendgrid api key", anchors: ["SG."], re: /\bSG\.[\w-]{20,24}\.[\w-]{40,50}/g },
  { kind: "twilio api key", anchors: ["SK"], re: /\bSK[0-9a-fA-F]{32}\b/g },
  {
    kind: "discord webhook url",
    anchors: ["discord"],
    re: /(?:https?:\/\/)?(?:[a-z]{3,6}\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,100}/g,
  },
  {
    // The bot token has no fixed prefix, so it needs the word "discord" nearby, as in gitleaks
    kind: "discord bot token",
    anchors: ["discord", "Discord", "DISCORD"],
    re: /\b[MNO][\w-]{23,25}\.[\w-]{6}\.[\w-]{27,38}\b/g,
  },
  { kind: "shopify token", anchors: ["shpat_", "shpca_", "shppa_", "shpss_"], re: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g },
  { kind: "digitalocean token", anchors: ["_v1_"], re: /\bdo[opr]_v1_[a-f0-9]{64}\b/g },
  { kind: "hugging face token", anchors: ["hf_"], re: /\bhf_[A-Za-z]{34}\b/g },
  { kind: "atlassian token", anchors: ["ATATT3"], re: /\bATATT3[\w=-]{150,250}/g },
  { kind: "linear api key", anchors: ["lin_api_"], re: /\blin_api_[A-Za-z0-9]{40}\b/g },
  { kind: "postman api key", anchors: ["PMAK-"], re: /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/g },
  { kind: "databricks token", anchors: ["dapi"], re: /\bdapi[a-f0-9]{32}(?:-\d)?\b/g },
  { kind: "grafana token", anchors: ["glsa_"], re: /\bglsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}\b/g },
  { kind: "new relic key", anchors: ["NRAK-"], re: /\bNRAK-[A-Z0-9]{27}\b/g },
  { kind: "vault token", anchors: ["hvs."], re: /\bhvs\.[\w-]{90,120}/g },
  { kind: "age secret key", anchors: ["AGE-SECRET-KEY-1"], re: /\bAGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}\b/g },
  { kind: "azure storage key", anchors: ["AccountKey="], re: /(AccountKey=)([A-Za-z0-9+/]{86}==)/g, context: true },
  {
    kind: "jwt",
    anchors: ["eyJ"],
    // The payload and signature are optional in the regex, so a header with no payload is consumed, not rescanned
    re: /\beyJ[\w-]{10,4000}(\.eyJ[\w-]{2,16000}\.[\w-]{0,4000})?/g,
    accept: (_, m) => m[1] !== undefined,
  },
  {
    kind: "url with password",
    anchors: ["://"],
    re: /\b([a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^\s:@/?#"'<>]{1,128}:)([^\s@/?#"'<>]{1,128})@/g,
    context: true,
    password: true,
    accept: (s) => !isPlaceholder(s),
    preview: (m) => m[1] + BULLETS + "@",
  },
];

/** The shortest string any prefix rule can match ("ab://u:p@") */
const PREFIX_MIN_LENGTH = 9;

const ANCHOR_FILTER = new RegExp(
  Array.from(new Set(PREFIX_RULES.flatMap((rule) => rule.anchors)))
    .map((anchor) => anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
);

interface Span {
  start: number;
  end: number;
  rule: PrefixRule;
  match: RegExpExecArray;
}

/**
 * All non-overlapping prefix-rule matches in `text`, in text order, at most `limit`.
 * Earlier rules win overlaps. Each rule's matches come in text order, so merging
 * them into the sorted list is linear.
 */
function findPrefixSpans(text: string, limit: number): Span[] {
  if (text.length < PREFIX_MIN_LENGTH || !ANCHOR_FILTER.test(text)) return [];
  let spans: Span[] = [];
  for (const rule of PREFIX_RULES) {
    if (spans.length >= limit) break;
    if (!rule.anchors.some((anchor) => text.includes(anchor))) continue;
    const found: Span[] = [];
    const re = rule.re;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (spans.length + found.length < limit && (m = re.exec(text)) !== null) {
      const start = rule.context ? m.index + m[1].length : m.index;
      const secret = rule.context ? m[2] : m[0];
      if (!rule.accept || rule.accept(secret, m)) found.push({ start, end: start + secret.length, rule, match: m });
    }
    re.lastIndex = 0;
    if (found.length === 0) continue;
    if (spans.length === 0) {
      spans = found;
      continue;
    }
    // Merge, dropping new spans that overlap a kept one
    const merged: Span[] = [];
    let i = 0;
    for (const span of found) {
      while (i < spans.length && spans[i].end <= span.start) merged.push(spans[i++]);
      if (i < spans.length && spans[i].start < span.end) continue;
      const prev = merged[merged.length - 1];
      if (prev && prev.end > span.start) continue;
      merged.push(span);
    }
    while (i < spans.length) merged.push(spans[i++]);
    spans = merged;
  }
  return spans;
}

/** First 4 and last 4 characters for long values, otherwise bullets only. Never the whole value. */
function mask(secret: string): string {
  return secret.length >= 16 ? secret.slice(0, 4) + BULLETS + secret.slice(-4) : BULLETS;
}

function spanPreview(span: Span): string {
  if (span.rule.preview) return span.rule.preview(span.match);
  if (span.rule.password) return BULLETS;
  return mask(span.rule.context ? span.match[2] : span.match[0]);
}

// ---------------------------------------------------------------------------
// key-name rule

/** Words that make a key suspicious on their own */
const SECRET_WORDS = new Map([
  ["password", "password"],
  ["passwd", "password"],
  ["pwd", "password"],
  ["pass", "password"],
  ["passphrase", "password"],
  ["secret", "secret"],
  ["token", "token"],
  ["apikey", "api key"],
  ["credential", "credential"],
  ["credentials", "credential"],
  ["auth", "auth"],
  ["authorization", "auth"],
  ["bearer", "auth"],
  ["privatekey", "private key"],
  ["accesskey", "access key"],
  ["secretkey", "secret key"],
]);

/** `<word> key` pairs that are suspicious, for example api_key or signingKey */
const KEY_PAIR_WORDS = new Set(["api", "private", "access", "secret", "signing", "encryption", "master", "account", "auth", "client", "session"]);

/**
 * Words that turn a suspicious key into metadata about the secret, for example
 * password_min_length, token_type, secret_name or next_page_token.
 */
const METADATA_WORDS = new Set([
  "count", "length", "len", "min", "max", "size", "limit", "type", "kind", "url", "uri", "endpoint",
  "path", "file", "dir", "name", "id", "ids", "expiry", "expires", "expiration", "expire", "expired",
  "ttl", "timeout", "lifetime", "age", "date", "time", "at", "policy", "required", "enabled", "enable",
  "disabled", "disable", "rotation", "field", "label", "prompt", "hint", "placeholder", "description",
  "desc", "format", "pattern", "regex", "strength", "version", "ref", "reference", "arn", "env",
  "var", "usage", "used", "remaining", "budget", "rate", "index", "prefix", "suffix", "page", "next",
  "continuation", "pagination", "cursor", "reset", "changed", "updated", "last", "set", "show",
  "visible", "is", "has", "should", "allow", "allowed", "mode", "method", "algorithm", "algo", "scope",
  "scopes", "audience", "issuer", "location", "store", "provider", "source", "manager", "service",
  "address", "symbol", "decimals", "param", "parameter", "status", "valid", "validity", "error",
  "message", "msg", "title", "rules", "check",
]);

/** Keys whose values are often random but not secret: skip the entropy rule under them */
const NON_SECRET_RANDOM_WORDS = new Set([
  "id", "ids", "uuid", "guid", "uid", "hash", "checksum", "digest", "etag", "sha", "sha1", "sha256",
  "sha512", "md5", "integrity", "fingerprint", "nonce", "cursor", "commit", "revision", "rev", "version",
  "salt", "iv", "request", "trace", "span", "correlation", "slug", "ref", "sku", "isbn", "hex", "color",
]);

interface KeyClass {
  /** The kind for the key-name rule, or null when the key is not suspicious */
  kind: string | null;
  /** False under keys like `id` or `checksum` */
  entropy: boolean;
}

const NEUTRAL_KEY: KeyClass = { kind: null, entropy: true };
const keyCache = new Map<string, KeyClass>();
const KEY_CACHE_MAX = 10_000;

/** Split a key into lowercase words: snake_case, kebab-case, camelCase, "APIKey", "@_password" */
export function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function classifyKey(key: string): KeyClass {
  // Keys longer than this are data, not field names
  if (key.length > 64) return NEUTRAL_KEY;
  let cls = keyCache.get(key);
  if (cls) return cls;
  const words = splitKeyWords(key);
  let concept: string | null = null;
  let entropy = true;
  let metadata = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (METADATA_WORDS.has(word)) metadata = true;
    if (NON_SECRET_RANDOM_WORDS.has(word)) entropy = false;
    if (concept) continue;
    const single = SECRET_WORDS.get(word);
    if (single) concept = single;
    else if ((word === "key" || word === "keys") && i > 0 && KEY_PAIR_WORDS.has(words[i - 1])) {
      concept = `${words[i - 1]} key`;
    }
  }
  cls = concept && !metadata ? { kind: `${concept} field`, entropy } : entropy ? NEUTRAL_KEY : { kind: null, entropy };
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(key, cls);
  return cls;
}

const PLACEHOLDER_WORDS = new Set([
  "null", "nil", "none", "undefined", "true", "false", "yes", "no", "on", "off", "n/a", "na", "tbd",
  "todo", "fixme", "changeme", "change_me", "change-me", "changeit", "password", "passwd", "pass",
  "secret", "token", "apikey", "api_key", "api-key", "key", "example", "sample", "test", "testing",
  "dummy", "fake", "placeholder", "redacted", "hidden", "masked", "default", "empty", "required",
  "optional", "string", "value",
]);

/** Characters of mask strings such as "****", "xxxx-xxxx" or "••••" */
const MASK_CHARS = /^[*•·xX#._\-\s?]+$/;
/** Template and variable references: <your-key>, ${VAR}, {{ .Values.x }}, $VAR, %VAR%, [REDACTED] */
const TEMPLATE = /^(?:<[^>]*>|\$\{[^}]*\}|\$\([^)]*\)|\{\{[\s\S]*\}\}|\{%[\s\S]*%\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|\[[^\]]*\])$/;
const PLACEHOLDER_HINT = /your|example|placeholder|changeme|change_me|replace[_-]?me|redacted|insert|dummy|xxxx/i;

/**
 * True for values that are not real secrets: empty, a flag word, a mask, a
 * template reference or an obvious placeholder. Values over 64 characters are
 * checked for templates only, and values over 256 not at all.
 */
export function isPlaceholder(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) return true;
  if (text.length > 256) return false;
  if (TEMPLATE.test(text)) return true;
  if (text.length > 64) return false;
  if (PLACEHOLDER_WORDS.has(text.toLowerCase())) return true;
  if (MASK_CHARS.test(text)) return true;
  // One repeated character: "0000", "aaaaaaaa"
  let same = true;
  for (let i = 1; i < text.length && same; i++) same = text.charCodeAt(i) === text.charCodeAt(0);
  if (same) return true;
  return PLACEHOLDER_HINT.test(text);
}

// ---------------------------------------------------------------------------
// entropy rule

/**
 * Entropy thresholds. Random base62 strings measured over 5,000 samples: length 32
 * has entropy ≥ 4.31 for 95% of samples, 40 → 4.55, 64 → 4.98. The threshold is
 * 0.85 × log2(length), capped at 5.2, which keeps ~95% of truly random strings while
 * rejecting identifiers like "getUserAccountSettingsById2024" (4.2 at 37).
 */
const ENTROPY_MIN_LENGTH = 32;
const ENTROPY_MAX_LENGTH = 256;
const ENTROPY_FACTOR = 0.85;
const ENTROPY_CAP = 5.2;
const counts = new Uint16Array(128);

/**
 * True for random-looking strings: 32–256 characters of the base64/base62 alphabet
 * (no spaces or dots), with upper case, lower case and at least two digits, not pure
 * hex, and Shannon entropy over the threshold.
 *
 * Deliberately conservative, since hashes and IDs are random too:
 * - Under 32 characters is skipped: nanoid, Firebase and YouTube IDs are shorter.
 * - Hex is skipped (UUIDs, sha1/sha256 hashes, commit ids, Mongo ObjectIds), unless
 *   the key-name rule flags it. Hex secrets with no other signal are missed.
 * - Over 256 characters is skipped: long base64 blobs are data (images, certificates).
 * - Subresource integrity hashes ("sha512-...") are skipped.
 * - Base64 of ordinary text can still be flagged; that is a "possible" secret.
 */
export function isRandomLooking(value: string): boolean {
  const n = value.length;
  if (n < ENTROPY_MIN_LENGTH || n > ENTROPY_MAX_LENGTH) return false;
  if (value.startsWith("sha") && /^sha(?:1|256|384|512)-/.test(value)) return false;
  let upper = 0;
  let lower = 0;
  let digits = 0;
  let nonHex = 0;
  for (let i = 0; i < n; i++) {
    const c = value.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      upper++;
      if (c > 70) nonHex++;
    } else if (c >= 97 && c <= 122) {
      lower++;
      if (c > 102) nonHex++;
    } else if (c >= 48 && c <= 57) {
      digits++;
    } else if (c !== 43 && c !== 47 && c !== 61 && c !== 95 && c !== 45) {
      // Not one of + / = _ -
      return false;
    }
  }
  if (upper === 0 || lower === 0 || digits < 2 || nonHex === 0) return false;
  for (let i = 0; i < n; i++) counts[value.charCodeAt(i)]++;
  let entropy = 0;
  for (let i = 0; i < n; i++) {
    const c = value.charCodeAt(i);
    const count = counts[c];
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
    counts[c] = 0;
  }
  return entropy >= Math.min(ENTROPY_FACTOR * Math.log2(n), ENTROPY_CAP);
}

// ---------------------------------------------------------------------------
// paths

type PathKey = string | number;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `db.password`, `[3].token`, `servers[0].auth.key`, `["key.with.dot"]` */
export function formatPath(keys: PathKey[]): string {
  let out = "";
  for (const key of keys) {
    if (typeof key === "number") out += `[${key}]`;
    else if (IDENTIFIER.test(key)) out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}

/** The inverse of `formatPath`. Returns null when the path is malformed. */
export function parsePath(path: string): PathKey[] | null {
  const keys: PathKey[] = [];
  let i = 0;
  while (i < path.length) {
    const c = path[i];
    if (c === "[") {
      if (path[i + 1] === '"') {
        // Find the closing quote, skipping escapes
        let j = i + 2;
        while (j < path.length && path[j] !== '"') j += path[j] === "\\" ? 2 : 1;
        if (path[j + 1] !== "]") return null;
        try {
          keys.push(JSON.parse(path.slice(i + 1, j + 1)) as string);
        } catch {
          return null;
        }
        i = j + 2;
      } else {
        const close = path.indexOf("]", i);
        if (close < 0) return null;
        const index = Number(path.slice(i + 1, close));
        if (!Number.isInteger(index) || index < 0) return null;
        keys.push(index);
        i = close + 1;
      }
    } else {
      if (c === ".") {
        if (keys.length === 0) return null;
        i++;
      }
      let j = i;
      while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
      if (j === i) return null;
      keys.push(path.slice(i, j));
      i = j;
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// scan

interface Frame {
  value: unknown;
  /** Object keys, or null for an array */
  keys: string[] | null;
  next: number;
  parent: Frame | null;
  /** This frame's key in its parent */
  key: PathKey;
  /** For arrays: the class of the key the array is under, applied to its items */
  itemClass: KeyClass;
}

function framePath(frame: Frame, last: PathKey): string {
  const keys: PathKey[] = [last];
  for (let f = frame; f && f.parent; f = f.parent) keys.push(f.key);
  return formatPath(keys.reverse());
}

/** Plain objects and arrays; typed arrays, dates, maps and sets are leaves */
function isContainer(value: unknown): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof Date) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

function scan(value: unknown, maxFindings: number): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (maxFindings <= 0) return findings;

  if (typeof value === "string") {
    for (const span of findPrefixSpans(value, maxFindings)) {
      findings.push({ path: "", kind: span.rule.kind, rule: "prefix", preview: spanPreview(span) });
    }
    return findings;
  }
  if (!isContainer(value)) return findings;

  const checkString = (text: string, parent: Frame, key: PathKey, keyKind: string | null, entropy: boolean) => {
    const spans = findPrefixSpans(text, maxFindings - findings.length);
    if (spans.length > 0) {
      const path = framePath(parent, key);
      for (const span of spans) findings.push({ path, kind: span.rule.kind, rule: "prefix", preview: spanPreview(span) });
      return;
    }
    if (keyKind) {
      const minLength = keyKind === "password field" ? 3 : 8;
      if (text.trim().length >= minLength && !isPlaceholder(text)) {
        findings.push({
          path: framePath(parent, key),
          kind: keyKind,
          rule: "key-name",
          preview: keyKind === "password field" ? BULLETS : mask(text),
        });
      }
      return;
    }
    if (entropy && isRandomLooking(text)) {
      findings.push({ path: framePath(parent, key), kind: "high-entropy string", rule: "entropy", preview: mask(text) });
    }
  };

  const makeFrame = (v: object, parent: Frame | null, key: PathKey, itemClass: KeyClass): Frame => ({
    value: v,
    keys: Array.isArray(v) ? null : Object.keys(v),
    next: 0,
    parent,
    key,
    itemClass,
  });

  const stack: Frame[] = [makeFrame(value, null, "", NEUTRAL_KEY)];
  while (stack.length > 0 && findings.length < maxFindings) {
    const frame = stack[stack.length - 1];
    const container = frame.value as Record<string, unknown> & unknown[];
    let child: unknown;
    let key: PathKey;
    let cls: KeyClass;
    if (frame.keys === null) {
      if (frame.next >= container.length) {
        stack.pop();
        continue;
      }
      key = frame.next++;
      child = container[key];
      cls = frame.itemClass;
    } else {
      if (frame.next >= frame.keys.length) {
        stack.pop();
        continue;
      }
      key = frame.keys[frame.next++];
      child = container[key];
      cls = classifyKey(key);
    }
    if (typeof child === "string") {
      checkString(child, frame, key, cls.kind, cls.entropy);
    } else if (isContainer(child)) {
      stack.push(makeFrame(child, frame, key, cls));
    }
  }
  return findings.length > maxFindings ? findings.slice(0, maxFindings) : findings;
}

/**
 * Find values that look like secrets. Stops after LIMITS.secretsMaxFindings.
 * The previews are masked; a finding never holds the whole secret.
 */
export function scanSecrets(value: unknown): SecretFinding[] {
  return scan(value, LIMITS.secretsMaxFindings);
}

// ---------------------------------------------------------------------------
// redact

/** Replace prefix-rule matches in `text`; the whole string when nothing matches (fail closed) */
function redactPrefixMatches(text: string): string {
  const spans = findPrefixSpans(text, Infinity);
  if (spans.length === 0) return REDACTED;
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + REDACTED;
    last = span.end;
  }
  return out + text.slice(last);
}

function shallowCopy(value: object): Record<PathKey, unknown> {
  if (Array.isArray(value)) return value.slice() as unknown as Record<PathKey, unknown>;
  // Spread defines own properties, so a "__proto__" key stays a key
  if (Object.getPrototypeOf(value) !== null) return { ...value } as Record<PathKey, unknown>;
  return Object.assign(Object.create(null), value);
}

function setOwn(target: Record<PathKey, unknown>, key: PathKey, value: unknown) {
  if (key === "__proto__") Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  else target[key] = value;
}

function hasOwn(target: object, key: PathKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Return a copy of `value` with each finding's value masked. Never changes `value`.
 *
 * Structural sharing: only the objects and arrays on the path to a finding are
 * copied; every other branch is the same reference as in `value`. A key-name or
 * entropy finding replaces the whole value with "[REDACTED]"; a prefix finding
 * replaces only the matched parts of the string, found by running the prefix rules
 * again (findings carry no offsets).
 *
 * When the findings hit the cap, the scan runs again without the cap, so values
 * past the cap are redacted too.
 */
export function redactSecrets(value: unknown, findings: SecretFinding[]): unknown {
  if (findings.length === 0) return value;
  if (findings.length >= LIMITS.secretsMaxFindings) findings = scan(value, Infinity);

  // Per path: true when the whole value goes, false when only the prefix matches go
  const byPath = new Map<string, boolean>();
  for (const finding of findings) {
    byPath.set(finding.path, (byPath.get(finding.path) ?? false) || finding.rule !== "prefix");
  }

  const redactLeaf = (leaf: unknown, whole: boolean): unknown =>
    whole || typeof leaf !== "string" ? REDACTED : redactPrefixMatches(leaf);

  if (byPath.has("")) return redactLeaf(value, byPath.get("")!);
  if (!isContainer(value)) return value;

  const root = shallowCopy(value);
  const copies = new WeakSet<object>([root]);
  for (const [path, whole] of byPath) {
    const keys = parsePath(path);
    if (!keys || keys.length === 0) continue;
    let node = root;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!hasOwn(node, key)) break;
      const child = node[key];
      if (i === keys.length - 1) {
        setOwn(node, key, redactLeaf(child, whole));
        break;
      }
      if (!isContainer(child)) break;
      let copy = child as Record<PathKey, unknown>;
      if (!copies.has(copy)) {
        copy = shallowCopy(child);
        copies.add(copy);
        setOwn(node, key, copy);
      }
      node = copy;
    }
  }
  return root;
}
