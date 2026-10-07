# Test data

Sample inputs for manual testing. Open a file, copy everything, and paste it into the ParseBox input panel.

There is one folder per input format. The folder names match the format `value`s in `formatOptions` (`src/config/formats.ts`).

## Shared data sets

Many formats contain the same data, so you can compare conversions:

- **users**: 3 users (`id`, `name`, `email`, `role`, `active`, `age`). It is a flat list, so it also fits CSV, TSV, JSONL and TOON tables.
- **config**: a nested app config (`app`, `server`, `database`). It is an object at the root, so it also fits TOML, INI, dotenv and query strings.
- **order-nested**: an order with nested objects, a list of items, `null` and an empty string.

## Copy and paste rules

- The Base64, hex, binary, MessagePack, URI and query string files have **no trailing line break**. Auto detect and the readers accept one, but keep the files without it.
- The hex and binary readers skip spaces and line breaks between digits. Any other character is an error.
- The Base64, hex and binary readers decode UTF-8. Bytes that are not UTF-8 stay bytes, and the Base64, hex and binary writers write them back exactly.
- MessagePack input and output is Base64 text of the binary data.

## Files

| Folder | Files | What they cover |
|---|---|---|
| `text/` | `paragraph.txt`, `server-log.txt`, `unicode.txt` | Plain prose, a multi-line log, non-Latin scripts and emoji |
| `json/` | `users.json`, `config.json`, `order-nested.json`, `edge-cases.json` | Lists, nesting, `null`, escapes, exponents, empty values, odd keys |
| `json5/` | `config.json5`, `numbers.json5`, `strings.json5` | Comments, unquoted keys, trailing commas, hex, `Infinity`, `NaN`, single quotes |
| `xml/` | `catalog.xml`, `config.xml`, `rss-feed.xml` | Attributes, repeated elements, self-closing tags, namespaces, CDATA, entities |
| `yaml/` | `config.yaml`, `users.yaml`, `anchors-and-multiline.yaml`, `github-workflow.yaml` | Nesting, lists, anchors, merge keys, literal and folded blocks |
| `toml/` | `config.toml`, `cargo.toml`, `array-of-tables.toml`, `types.toml` | Tables, inline tables, arrays of tables, dates, hex and underscored numbers |
| `toon/` | `users.toon`, `config.toon`, `order-nested.toon` | Tabular arrays, nested objects (generated with `@toon-format/toon`) |
| `ini/` | `config.ini`, `php.ini`, `gitconfig.ini` | Sections, `;` comments, dotted keys, quoted section names |
| `dotenv/` | `app.env`, `quoting.env` | Plain values, quotes, empty values, inline comments, multi-line values |
| `csv/` | `users.csv`, `products-quoted.csv`, `sparse.csv` | Quoted commas, escaped quotes, line breaks in fields, empty fields |
| `tsv/` | `users.tsv`, `inventory.tsv` | Tab-separated rows, commas inside fields |
| `jsonl/` | `users.jsonl`, `events.jsonl` | One JSON object per line, nested data |
| `msgpack/` | `users.txt`, `config.txt`, `order-nested.txt` | Base64 of MessagePack (generated with `@msgpack/msgpack`) |
| `base64/` | `users-json.txt`, `plain-text.txt` | Base64 of JSON (decodes to an object) and of plain text |
| `hex/` | `config-json.txt`, `plain-text.txt` | Hex of JSON and of plain text |
| `binary/` | `small-json-spaced.txt`, `hello-continuous.txt` | 8-bit groups with spaces, and one unbroken string |
| `uri/` | `json.txt`, `text.txt` | `encodeURIComponent` of JSON and of text with UTF-8 characters |
| `querystring/` | `simple.txt`, `nested-brackets.txt`, `config.txt` | `+` for spaces, `%20`, bracket nesting, arrays |

## Stress tests

The `stress/` folder holds inputs that push ParseBox to its limits: big payloads, deep nesting, stacked encoding layers, the caps in `src/config/limits.ts` and secret detection. These files do not follow the one-folder-per-format rule. Paste them in **Auto Detect** mode unless a row says something else.

`stress/generate.ts` writes every file from a seeded random generator, so each run writes the same bytes. To make the files again, run `npm run stress-data`. To also make the `huge/` files (about 120 MB), run `npm run stress-data -- --huge`. Git ignores `huge/`.

The "Result" column is what the pipeline did when the files were made. A result in **bold** is a problem to fix, not the wanted behavior.

### `stress/layers/`: encoding chains

The decode chain removes at most 5 layers (`LIMITS.decodeMaxDepth`).

| File | Result |
|---|---|
| `hex-base64-gzip-json.txt` | hex → Base64 → gzip → JSON |
| `binary-hex-base64-gzip-json.txt` | binary → hex → Base64 → gzip → JSON |
| `uri-base64-zlib-json.txt` | URI → Base64 → zlib → JSON |
| `base64-gzip-gzip-gzip-json.txt` | Base64 → gzip → gzip → gzip → JSON |
| `base64-hex-base64-gzip-gzip-json.txt` | Exactly 5 layers, all removed |
| `hex-base64-hex-base64-gzip-gzip-json.txt` | 6 layers. The chain stops after 3 (hex → Base64 → hex) and shows Base64, because the last 3 do not fit in the 2 that are left |
| `base64-gzip-msgpack.txt` | Base64 → gzip → MessagePack, shown as JSON |
| `hex-zlib-msgpack.txt` | hex → zlib → MessagePack with a binary field |
| `base64-gzip-random-bytes.txt` | Base64 → gzip → 4 KB of non-text bytes, shown as Base64 |
| `base64-jwt.txt` | Base64 → JWT, with `dates` for `iat`, `nbf` and `exp` |
| `json-string-x3.json` | 3 levels of JSON string, all removed |
| `json-string-x7.json` | 7 levels. None are removed and the output is one string (encoding chains remove the first 5 instead) |

### `stress/limits/`: the size caps

| File | Cap | Result |
|---|---|---|
| `zip-bomb-60mb.txt` | `decompressMaxBytes` (50 MB) | 300 bytes of double gzip that expand to 60 MB. Error: "The gzip data expands to more than 50 MB" |
| `gzip-45mb-under-cap.txt` | `decompressMaxBytes` | 1 KB that expands to 45 MB of JSON (176,066 items). About 1 s to JSON, 2.5 s to YAML |
| `gzip-truncated.txt` | 128-byte corrupt report | Error: "The gzip data is corrupt or truncated" |
| `gzip-magic-short.txt` | 128-byte corrupt report | Gzip magic bytes and noise, too short to report. Stays Base64 |
| `users-260kb.json` | `largeInputChars` (250,000) | The input pane shows the read-only preview |
| `orders-200kb.csv` | `displayMaxChars` (250,000) | 3,000 rows. The JSON output is longer than the output pane shows |

### `stress/large/`: big payloads under the caps

| File | What it tests |
|---|---|
| `users-1mb.min.json` | 1 MB of JSON on one line |
| `events-1mb.jsonl` | 9,028 JSONL lines |
| `orders-1mb.csv` | 15,000 rows with quoted commas, quotes and line breaks in fields |
| `catalog-1mb.xml` | 3,000 elements with attributes, namespaces and CDATA |
| `wide-object-20k-keys.json` | One object with 20,000 keys |
| `long-string-1mb.json` | One string value of 1,048,576 characters |
| `base64-gzip-users-5mb.txt` | 940 KB of Base64 that expands to 5 MB of JSON |
| `broken-500kb.json` | Single quotes, unquoted keys, comments and trailing commas. Repair makes 16,956 fixes |

### `stress/deep/`: deep nesting

Real data is rarely more than 100 levels deep. These files use 1,000 levels, which is far past real data. The writers are recursive, so they have a depth limit. In node, every output works to at least 1,792 levels, so 1,000 leaves room for browsers with a smaller stack. Past the limit, the output shows "Maximum call stack size exceeded".

| File | Result |
|---|---|
| `array-1k.json` | 1,000 nested arrays |
| `object-1k.json` | 1,000 nested objects |
| `mixed-1k.json` | 1,000 levels of arrays and objects. The indents make 13 KB into 3 MB of output. JSON5 output takes about 1 s |
| `xml-1k.xml` | 1,000 nested elements |
| `yaml-300.yaml` | 300 indent levels |
| `toml-dotted-1k.toml` | One key with 1,000 dotted parts. **CSV output fails with "str.toString is not a function"** |
| `querystring-500.txt` | 500 bracket levels (`a[b][b]...`) |

MessagePack output stops at 100 levels ("Too deep objects in depth 101"). That is a limit of `@msgpack/msgpack`.

### `stress/edge/`: values that are hard to keep exact

| File | Result |
|---|---|
| `unicode-stress.json` | Astral characters, ZWJ emoji, combining marks, RTL text, zero-width characters, U+2028, control characters, lone surrogates, odd keys |
| `numbers-stress.json` | **Values change with no loss report**: `1e400` becomes `null`, `-0` becomes `0`, integers past 2^53 lose digits |
| `prototype-keys.json` | `__proto__`, `constructor` and `toString` keys stay in data output. **Every type output fails with "known.slice is not a function"** |
| `bom-and-crlf.json` | A byte order mark and CRLF line breaks. **Repair runs and reports "syntax fixed"** for valid JSON |
| `yaml-type-traps.yaml` | `NO`, `yes`, `0777`, `1:30`, dates, `.inf`, anchors and merge keys |

### `stress/secrets/`: secret detection

| File | Result |
|---|---|
| `key-names.json` | `flagged` has 13 findings: key-name rule, entropy rule, a URL with a password and a JWT in a log line. `notFlagged` has none: metadata keys, placeholders, the AWS documentation key, hashes and IDs. `debatable` has 2 entropy findings under keys that are not secret |
| `app.env` | 5 findings in dotenv. `${STRIPE_KEY_FROM_VAULT}` and `TOKEN_TTL` are skipped |
| `server-log.txt` | Plain text, so only the prefix rule runs: 2 findings (URL with a password, JWT) |
| `vendor-tokens-base64-gzip.txt` | Base64 → gzip → one fake token for each prefix rule: 35 findings |
| `300-passwords.json` | 300 password fields. The scan stops at 200 (`secretsMaxFindings`) |

The vendor tokens are Base64 of gzip because GitHub push protection can block fake tokens in plain text. Auto detect removes both layers before the scan.

### `stress/huge/`: made only with `--huge`

| File | Result |
|---|---|
| `users-12mb.json` | Over `secretsMaxChars` (10 MB): "secret scan (over 10 MB)" is skipped |
| `events-25mb.jsonl` | 25 MB of JSONL |
| `orders-30mb.csv` | 450,000 rows |
| `catalog-20mb.xml` | 60,000 elements. About 3 s to parse |
| `broken-21mb.json` | Over `repairMaxChars` (20 MB), with one missing comma. **Auto detect calls it plain text, with no parse error and no "repair skipped" note** |
| `base64-gzip-users-40mb.txt` | 7.5 MB of Base64 that expands to 40 MB of JSON |
