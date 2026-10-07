/**
 * The landing pages: one URL per popular conversion, such as /json-to-yaml.
 *
 * The app reads this file to preselect the formats and the sample on a landing
 * page. The build (src/seo/vite-plugin.ts) reads it to write one static HTML
 * file per page, the sitemap and llms.txt. Keep it free of React, DOM APIs and
 * `@/` imports, so that node --test and vite.config.ts can import it.
 */

export const SITE_URL = "https://parsebox.app";

export type PageGroup = "data" | "types" | "tools";

export const pageGroupLabels: Record<PageGroup, string> = {
  data: "Data conversions",
  types: "Type generators",
  tools: "Encoders, decoders and formatters",
};

export interface LandingPage {
  /** The URL path without a slash, for example "json-to-yaml" */
  slug: string;
  /** A format `value` from formatOptions that the input select accepts */
  input: string;
  /** A format `value` from formatOptions that the output select accepts */
  output: string;
  group: PageGroup;
  /** The page heading, also the start of the <title> */
  h1: string;
  /** The meta description: 120 to 160 characters, unique to the page */
  description: string;
  /** 2 or 3 sentences under the heading, unique to the page */
  intro: string;
  /** A key of `samples`; the default is the input format */
  sample?: string;
}

export const home = {
  title: "ParseBox — Convert JSON, YAML, XML, CSV & 20+ Formats",
  description:
    "Convert JSON, YAML, XML, CSV, TOML and 20+ formats. Decode JWT and Base64. Generate TypeScript, Zod and Go types. Free, private, in your browser.",
  h1: "Convert JSON, YAML, XML, CSV and 20+ formats in your browser",
  intro:
    "Paste text in any supported format and get it back in another. ParseBox detects the input format, peels Base64 and URL encoding, repairs broken JSON and tells you what the target format cannot keep. It also generates types for TypeScript, Zod, Go, Rust, Python and more from a sample.",
};

/** Small sample inputs. A landing page opens with its sample in the input editor. */
export const samples: Record<string, string> = {
  json: `{
  "name": "parsebox",
  "version": "2.1.0",
  "private": false,
  "maintainers": [
    { "name": "Ada Lovelace", "email": "ada@example.com", "active": true },
    { "name": "Alan Turing", "email": "alan@example.com", "active": false }
  ],
  "build": {
    "target": "es2022",
    "minify": true,
    "port": 5173
  }
}
`,
  "json-records": `[
  { "id": 1, "name": "Ada Lovelace", "role": "admin", "active": true },
  { "id": 2, "name": "Alan Turing", "role": "editor", "active": true },
  { "id": 3, "name": "Grace Hopper", "role": "viewer", "active": false }
]
`,
  "json-xml": `{
  "order": {
    "@_id": "A-1042",
    "customer": "Ada Lovelace",
    "item": [
      { "@_sku": "KB-01", "qty": 1, "price": 49.5 },
      { "@_sku": "MS-07", "qty": 2, "price": 19.99 }
    ],
    "paid": true
  }
}
`,
  "json-env": `{
  "NODE_ENV": "production",
  "PORT": 8080,
  "API_URL": "https://api.example.com",
  "DEBUG": false
}
`,
  "json-query": `{
  "q": "json to yaml",
  "page": 2,
  "filters": { "lang": ["en", "de"], "sort": "recent" }
}
`,
  "json-messy": `{"name":"parsebox","tags":["json","yaml",],"nested":{"ok":true,"count":3},}`,
  yaml: `# Service config
service:
  name: api
  replicas: 3
  ports:
    - 8080
    - 8443
defaults: &defaults
  timeout: 30
  retries: 2
production:
  <<: *defaults
  timeout: 60
`,
  csv: `id,name,role,active
1,Ada Lovelace,admin,true
2,Alan Turing,editor,true
3,Grace Hopper,viewer,false`,
  tsv: `id\tname\trole\tactive
1\tAda Lovelace\tadmin\ttrue
2\tAlan Turing\teditor\ttrue
3\tGrace Hopper\tviewer\tfalse`,
  xml: `<!-- Order export -->
<order id="A-1042">
  <customer>Ada Lovelace</customer>
  <item sku="KB-01" qty="1">Keyboard</item>
  <item sku="MS-07" qty="2">Mouse</item>
  <paid>true</paid>
</order>
`,
  toml: `# App settings
title = "ParseBox"
version = "2.1.0"

[server]
host = "0.0.0.0"
port = 8080
started = 2026-01-15T09:30:00Z

[[users]]
name = "Ada"
admin = true

[[users]]
name = "Alan"
admin = false
`,
  ini: `; Database settings
[database]
host = localhost
port = 5432
name = app

[cache]
enabled = true
ttl = 300
`,
  dotenv: `# Local settings
NODE_ENV=development
PORT=3000
API_URL=https://api.example.com
FEATURE_FLAGS=search,export
`,
  jsonl: `{"id":1,"event":"signup","user":"ada"}
{"id":2,"event":"login","user":"alan"}
{"id":3,"event":"purchase","user":"ada","amount":49.5}
`,
  querystring: "q=json+to+yaml&page=2&filters[lang][]=en&filters[lang][]=de&sort=recent",
  // An unsigned demo token: the claims are fake and the signature is plain text
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzg0MjEiLCJuYW1lIjoiQWRhIExvdmVsYWNlIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzY3MjI1NjAwLCJleHAiOjE3NjcyMjkyMDB9.ZGVtby1zaWduYXR1cmUtbm90LWEtcmVhbC1rZXktMDAwMQ",
  base64:
    "SGVsbG8gZnJvbSBQYXJzZUJveCEgVGhpcyB0ZXh0IHdhcyBCYXNlNjQgZW5jb2RlZCwgYW5kIGl0IGRlY29kZXMgaW4geW91ciBicm93c2VyLg==",
  hex: "50 61 72 73 65 42 6f 78 20 74 75 72 6e 73 20 68 65 78 20 62 79 74 65 73 20 62 61 63 6b 20 69 6e 74 6f 20 72 65 61 64 61 62 6c 65 20 74 65 78 74 2e",
  binary:
    "01001000 01101001 00101100 00100000 01010000 01100001 01110010 01110011 01100101 01000010 01101111 01111000 00100001",
  uri: "https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dcaf%C3%A9%20%26%20cr%C3%A8me%26page%3D2",
  text: "Hello, world! Ünïcödé text & spaces: café, naïve, 東京",
};

export const landingPages: LandingPage[] = [
  // Data conversions
  {
    slug: "json-to-yaml",
    input: "json",
    output: "yaml",
    group: "data",
    h1: "JSON to YAML Converter",
    description:
      "Convert JSON to YAML in your browser. Paste JSON and get clean, indented YAML at once. Free, no sign-up, and your data never leaves your machine.",
    intro:
      "Turn JSON into YAML for Kubernetes manifests, GitHub Actions or any config file. ParseBox keeps key order and nesting, and writes multi-line strings so YAML can read them back.",
  },
  {
    slug: "yaml-to-json",
    input: "yaml",
    output: "json",
    group: "data",
    h1: "YAML to JSON Converter",
    description:
      "Convert YAML to JSON online. Anchors, aliases and merge keys are expanded, and comments are reported. Runs in your browser, so nothing is uploaded.",
    intro:
      "Paste a YAML file and get formatted JSON back. ParseBox expands anchors, aliases and merge keys, and it tells you that comments are dropped, because JSON has no comments.",
  },
  {
    slug: "json-to-csv",
    input: "json",
    output: "csv",
    group: "data",
    sample: "json-records",
    h1: "JSON to CSV Converter",
    description:
      "Convert a JSON array to CSV for Excel or Google Sheets. Keys become column headers. Free and private: the conversion runs in your browser.",
    intro:
      "Turn an array of JSON objects into a CSV table with one row per object and one column per key. ParseBox warns you when nested objects or arrays cannot fit in a flat cell.",
  },
  {
    slug: "csv-to-json",
    input: "csv",
    output: "json",
    group: "data",
    h1: "CSV to JSON Converter",
    description:
      "Convert CSV to JSON online. The header row becomes the keys and each line becomes an object. Free, fast and private, with no upload.",
    intro:
      "Paste CSV with a header row and get a JSON array of objects. Quoted fields, commas inside quotes and line breaks inside fields are handled the way spreadsheets write them.",
  },
  {
    slug: "xml-to-json",
    input: "xml",
    output: "json",
    group: "data",
    h1: "XML to JSON Converter",
    description:
      "Convert XML to JSON in your browser. Attributes become @_ keys and repeated tags become arrays. Free, with no upload and no sign-up.",
    intro:
      "Paste an XML document and get JSON you can work with in code. Attributes are kept as keys that start with @_, and repeated elements become arrays.",
  },
  {
    slug: "json-to-xml",
    input: "json",
    output: "xml",
    group: "data",
    sample: "json-xml",
    h1: "JSON to XML Converter",
    description:
      "Convert JSON to XML online. Keys that start with @_ become attributes and arrays become repeated elements. Free and runs in your browser.",
    intro:
      "Turn a JSON object into an indented XML document. Give a key the @_ prefix to write it as an attribute, and use an array to repeat an element.",
  },
  {
    slug: "json-to-toml",
    input: "json",
    output: "toml",
    group: "data",
    h1: "JSON to TOML Converter",
    description:
      "Convert JSON to TOML for Cargo, pyproject or app config files. Nested objects become dotted keys. Free, private and in your browser.",
    intro:
      "Turn a JSON object into TOML, the format of Cargo.toml and pyproject.toml. Nested objects become dotted keys such as build.port, and arrays of objects become inline tables.",
  },
  {
    slug: "toml-to-json",
    input: "toml",
    output: "json",
    group: "data",
    h1: "TOML to JSON Converter",
    description:
      "Convert TOML to JSON online. Tables, arrays of tables and dates are all read. Free, and the conversion runs entirely in your browser.",
    intro:
      "Paste a TOML file such as Cargo.toml or pyproject.toml and get JSON. ParseBox tells you when TOML dates become plain strings and when comments are dropped.",
  },
  {
    slug: "yaml-to-toml",
    input: "yaml",
    output: "toml",
    group: "data",
    h1: "YAML to TOML Converter",
    description:
      "Convert YAML to TOML in your browser. Nested mappings become dotted keys and anchors are expanded. Free, private and with no sign-up.",
    intro:
      "Move a config file from YAML to TOML. Nested mappings become dotted keys such as service.name, and anchors and merge keys are expanded because TOML has no references.",
  },
  {
    slug: "toml-to-yaml",
    input: "toml",
    output: "yaml",
    group: "data",
    h1: "TOML to YAML Converter",
    description:
      "Convert TOML to YAML online. Tables become nested mappings and arrays of tables become lists. Free, and nothing leaves your browser.",
    intro:
      "Move a config file from TOML to YAML. Tables become nested mappings and arrays of tables become YAML lists of objects.",
  },
  {
    slug: "xml-to-yaml",
    input: "xml",
    output: "yaml",
    group: "data",
    h1: "XML to YAML Converter",
    description:
      "Convert XML to YAML online. Elements become mappings, attributes become @_ keys and repeated tags become lists. Free and private.",
    intro:
      "Turn an XML document into readable YAML. Elements become nested mappings, attributes keep an @_ prefix and repeated elements become lists.",
  },
  {
    slug: "csv-to-yaml",
    input: "csv",
    output: "yaml",
    group: "data",
    h1: "CSV to YAML Converter",
    description:
      "Convert CSV to YAML in your browser. Each row becomes a list item and the header row gives the keys. Free, with no upload.",
    intro:
      "Turn a spreadsheet export into YAML. Each CSV row becomes one item in a YAML list, with the header row as its keys.",
  },
  {
    slug: "json-to-jsonl",
    input: "json",
    output: "jsonl",
    group: "data",
    sample: "json-records",
    h1: "JSON to JSONL Converter",
    description:
      "Convert a JSON array to JSON Lines (JSONL, NDJSON): one compact object per line. Good for logs, BigQuery and LLM fine-tuning files.",
    intro:
      "Turn a JSON array into JSON Lines, with one compact JSON value on each line. Use it for log pipelines, BigQuery loads and fine-tuning datasets.",
  },
  {
    slug: "jsonl-to-json",
    input: "jsonl",
    output: "json",
    group: "data",
    h1: "JSONL to JSON Converter",
    description:
      "Convert JSON Lines (JSONL, NDJSON) to a formatted JSON array online. Blank lines are skipped. Free and runs in your browser.",
    intro:
      "Paste JSON Lines or NDJSON and get one formatted JSON array. Each line becomes one item, and blank lines are skipped.",
  },
  {
    slug: "env-to-json",
    input: "dotenv",
    output: "json",
    group: "data",
    h1: ".env to JSON Converter",
    description:
      "Convert a .env file to JSON in your browser. Comments are skipped and quotes are removed. Private: secrets never leave your machine.",
    intro:
      "Paste a .env file and get a JSON object of its variables. ParseBox runs in your browser, so API keys and passwords in the file are never sent anywhere. It can also mask secrets in the output.",
  },
  {
    slug: "json-to-env",
    input: "json",
    output: "dotenv",
    group: "data",
    sample: "json-env",
    h1: "JSON to .env Converter",
    description:
      "Convert a flat JSON object to a .env file with one KEY=value line per key. Free, and it runs in your browser with no upload.",
    intro:
      "Turn a JSON object into .env lines for Docker, Node.js or any twelve-factor app. Each key becomes one KEY=value line.",
  },
  {
    slug: "ini-to-json",
    input: "ini",
    output: "json",
    group: "data",
    h1: "INI to JSON Converter",
    description:
      "Convert INI and .cfg files to JSON online. Sections become nested objects. Free, private and with nothing uploaded.",
    intro:
      "Paste an INI, .cfg or .conf file and get JSON. Each [section] becomes a nested object, and comments that start with ; or # are dropped.",
  },
  {
    slug: "query-string-to-json",
    input: "querystring",
    output: "json",
    group: "data",
    h1: "Query String to JSON Converter",
    description:
      "Convert a URL query string to JSON. Brackets such as filters[lang][]=en become nested objects and arrays. Free and in your browser.",
    intro:
      "Paste a URL query string or form body and see its structure as JSON. Bracket keys like filters[lang][]=en become nested objects and arrays.",
  },
  {
    slug: "json-to-query-string",
    input: "json",
    output: "querystring",
    group: "data",
    sample: "json-query",
    h1: "JSON to Query String Converter",
    description:
      "Convert JSON to a URL query string. Nested objects and arrays use bracket keys. Free, private and runs entirely in your browser.",
    intro:
      "Turn a JSON object into a URL query string. Nested objects and arrays are written with bracket keys, the style that PHP and the qs library read.",
  },
  {
    slug: "json-to-toon",
    input: "json",
    output: "toon",
    group: "data",
    h1: "JSON to TOON Converter",
    description:
      "Convert JSON to TOON (Token-Oriented Object Notation) to cut LLM prompt tokens. Arrays of objects become compact tables. Free and private.",
    intro:
      "TOON is a compact form of JSON for LLM prompts. Arrays of objects with the same keys become one header and one row per item, which uses fewer tokens than JSON.",
  },
  {
    slug: "tsv-to-json",
    input: "tsv",
    output: "json",
    group: "data",
    h1: "TSV to JSON Converter",
    description:
      "Convert tab-separated values to JSON. Paste cells copied from Excel or Google Sheets and get an array of objects. Free and in your browser.",
    intro:
      "Cells copied from a spreadsheet arrive as tab-separated text. Paste them here with the header row and get a JSON array of objects.",
  },

  // Type generators
  {
    slug: "json-to-typescript",
    input: "json",
    output: "typescript",
    group: "types",
    h1: "JSON to TypeScript Converter",
    description:
      "Generate TypeScript interfaces from JSON. Nested objects get their own named types and optional fields are found. Free and runs in your browser.",
    intro:
      "Paste a JSON response and get TypeScript interfaces for it. Nested objects become named interfaces, and fields missing from some items become optional.",
  },
  {
    slug: "json-to-zod",
    input: "json",
    output: "zod",
    group: "types",
    h1: "JSON to Zod Schema Generator",
    description:
      "Generate a Zod schema from a JSON sample. Get runtime validation and the inferred TypeScript type in one step. Free and private.",
    intro:
      "Paste a JSON sample and get a Zod schema that validates it at runtime. Use z.infer on the schema to get the TypeScript type as well.",
  },
  {
    slug: "json-to-json-schema",
    input: "json",
    output: "jsonschema",
    group: "types",
    h1: "JSON Schema Generator",
    description:
      "Generate a JSON Schema from a JSON sample. Types, required fields and nested objects are inferred. Free and runs in your browser.",
    intro:
      "Paste a JSON document and get a JSON Schema that describes it. Use the schema for API validation, OpenAPI specs or editor autocompletion.",
  },
  {
    slug: "json-to-go",
    input: "json",
    output: "go",
    group: "types",
    h1: "JSON to Go Struct Converter",
    description:
      "Convert JSON to Go structs with json tags. Nested objects get their own struct types. Free, private and in your browser.",
    intro:
      "Paste a JSON payload and get Go structs with json tags, ready for encoding/json. Nested objects become their own named struct types.",
  },
  {
    slug: "json-to-rust",
    input: "json",
    output: "rust",
    group: "types",
    h1: "JSON to Rust Struct Converter",
    description:
      "Generate Rust structs with serde derives from JSON. Field names are converted to snake_case with rename attributes. Free and private.",
    intro:
      "Paste a JSON sample and get Rust structs that derive serde's Serialize and Deserialize. Field names become snake_case, and rename attributes keep the JSON names.",
  },
  {
    slug: "json-to-pydantic",
    input: "json",
    output: "python",
    group: "types",
    h1: "JSON to Pydantic Model Converter",
    description:
      "Generate Pydantic models from JSON for FastAPI and Python apps. Nested objects become their own models. Free and runs in your browser.",
    intro:
      "Paste a JSON payload and get Pydantic models for FastAPI or any Python service. Nested objects become their own model classes.",
  },
  {
    slug: "json-to-csharp",
    input: "json",
    output: "csharp",
    group: "types",
    h1: "JSON to C# Class Converter",
    description:
      "Convert JSON to C# classes for System.Text.Json and .NET. Nested objects get their own types. Free, private and in your browser.",
    intro:
      "Paste a JSON response and get C# types for System.Text.Json. Nested objects become their own types, with property names in PascalCase.",
  },
  {
    slug: "json-to-kotlin",
    input: "json",
    output: "kotlin",
    group: "types",
    h1: "JSON to Kotlin Data Class Converter",
    description:
      "Generate Kotlin data classes from JSON for Android and Ktor. Nested objects become their own classes. Free and runs in your browser.",
    intro:
      "Paste a JSON sample and get Kotlin data classes marked @Serializable for kotlinx.serialization. Nested objects become their own data classes.",
  },
  {
    slug: "json-to-swift",
    input: "json",
    output: "swift",
    group: "types",
    h1: "JSON to Swift Codable Converter",
    description:
      "Generate Swift Codable structs from JSON for iOS and macOS apps. Nested objects get their own structs. Free, private and in your browser.",
    intro:
      "Paste a JSON response and get Swift structs that conform to Codable, ready for JSONDecoder. Nested objects become their own structs.",
  },
  {
    slug: "json-to-java",
    input: "json",
    output: "java",
    group: "types",
    h1: "JSON to Java Class Converter",
    description:
      "Generate Java records from JSON for Jackson and Spring. Nested objects become their own records. Free and runs in your browser with no upload.",
    intro:
      "Paste a JSON payload and get Java records for Jackson or Spring Boot. Nested objects become their own records, and @JsonProperty handles keys that are Java keywords.",
  },
  {
    slug: "json-to-protobuf",
    input: "json",
    output: "protobuf",
    group: "types",
    h1: "JSON to Protobuf Converter",
    description:
      "Generate a Protocol Buffers (.proto) schema from JSON for gRPC services. Nested objects become messages. Free, private and in your browser.",
    intro:
      "Paste a JSON sample and get a proto3 schema for gRPC or Protocol Buffers. Nested objects become their own messages and arrays become repeated fields.",
  },
  {
    slug: "yaml-to-typescript",
    input: "yaml",
    output: "typescript",
    group: "types",
    h1: "YAML to TypeScript Converter",
    description:
      "Generate TypeScript interfaces from a YAML file. Type your config files and Kubernetes manifests. Free and runs in your browser.",
    intro:
      "Paste a YAML config and get TypeScript interfaces that describe it. Use them to type config loaders, Helm values or CI files.",
  },

  // Encoders, decoders and formatters
  {
    slug: "json-formatter",
    input: "json",
    output: "json",
    group: "tools",
    sample: "json-messy",
    h1: "JSON Formatter and Validator",
    description:
      "Format, validate and repair JSON online. Pretty-print minified JSON and fix trailing commas and missing quotes. Free and private.",
    intro:
      "Paste minified or broken JSON and get it back indented. ParseBox shows the line of a syntax error, and it repairs common mistakes such as trailing commas, single quotes and missing quotes around keys.",
  },
  {
    slug: "jwt-decoder",
    input: "jwt",
    output: "json",
    group: "tools",
    h1: "JWT Decoder",
    description:
      "Decode a JWT and read its header, payload and claims. exp, iat and nbf are shown as dates. Your token never leaves your browser.",
    intro:
      "Paste a JSON Web Token and see its header and payload as JSON. The exp, iat and nbf claims are also shown as readable dates. The token is decoded in your browser and never sent to a server.",
  },
  {
    slug: "base64-decode",
    input: "base64",
    output: "text",
    group: "tools",
    h1: "Base64 Decoder",
    description:
      "Decode Base64 to text online. Handles UTF-8, URL-safe Base64 and Base64 that holds JSON. Free and runs in your browser.",
    intro:
      "Paste a Base64 string and read the text it holds. When the decoded bytes are JSON, ParseBox can format them, and bytes that are not text are kept exactly.",
  },
  {
    slug: "base64-encode",
    input: "text",
    output: "base64",
    group: "tools",
    h1: "Base64 Encoder",
    description:
      "Encode text to Base64 online. Unicode text is encoded as UTF-8 first. Free, with no upload: the encoding runs in your browser.",
    intro:
      "Type or paste text and get its Base64 encoding. The text is encoded as UTF-8, so accents, emoji and other scripts round-trip correctly.",
  },
  {
    slug: "url-decode",
    input: "uri",
    output: "text",
    group: "tools",
    h1: "URL Decoder",
    description:
      "Decode percent-encoded URLs and query values online. %20, %C3%A9 and other escapes become readable text. Free and in your browser.",
    intro:
      "Paste a percent-encoded URL or parameter and read it as plain text. UTF-8 escapes such as %C3%A9 become the characters they stand for.",
  },
  {
    slug: "url-encode",
    input: "text",
    output: "uri",
    group: "tools",
    h1: "URL Encoder",
    description:
      "Percent-encode text for URLs and query parameters online. Spaces, & and Unicode become safe escapes. Free and runs in your browser.",
    intro:
      "Type text and get it percent-encoded, safe to put in a URL path or query parameter. Unicode text is encoded as UTF-8.",
  },
  {
    slug: "hex-to-text",
    input: "hex",
    output: "text",
    group: "tools",
    h1: "Hex to Text Converter",
    description:
      "Convert hexadecimal bytes to readable UTF-8 text online. Spaces between bytes are fine. Free, private and runs in your browser.",
    intro:
      "Paste hexadecimal bytes, with or without spaces, and read them as UTF-8 text. Bytes that are not text are kept exactly instead of being lost.",
  },
  {
    slug: "binary-to-text",
    input: "binary",
    output: "text",
    group: "tools",
    h1: "Binary to Text Converter",
    description:
      "Convert binary (0s and 1s) to readable text online. Each 8-bit group is one byte, read as UTF-8. Free and runs in your browser.",
    intro:
      "Paste groups of 0s and 1s and read them as text. Each 8-bit group is one byte, and the bytes are read as UTF-8.",
  },
];

/** The sample text a landing page opens with. */
export function sampleFor(page: LandingPage): string {
  return samples[page.sample ?? page.input];
}

/** The page <title>: the heading with a short suffix, kept under 65 characters. */
export function pageTitle(page: LandingPage): string {
  const long = `${page.h1} — Free & In-Browser | ParseBox`;
  return long.length <= 65 ? long : `${page.h1} | ParseBox`;
}

export function pageUrl(page: LandingPage): string {
  return `${SITE_URL}/${page.slug}`;
}

/** The landing page for a URL path, such as "/json-to-yaml", "/json-to-yaml/" or "/json-to-yaml.html". */
export function findLandingPage(pathname: string): LandingPage | undefined {
  const slug = pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
  if (!slug) return undefined;
  return landingPages.find((page) => page.slug === slug);
}

/** Up to `limit` other pages with the same input or the same output format, closest first. */
export function relatedPages(page: LandingPage, limit = 8): LandingPage[] {
  const score = (other: LandingPage) =>
    (other.input === page.input ? 2 : 0) + (other.output === page.output ? 2 : 0) + (other.group === page.group ? 1 : 0);
  return landingPages
    .filter((other) => other !== page && (other.input === page.input || other.output === page.output))
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
