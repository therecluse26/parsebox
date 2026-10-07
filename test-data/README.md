# Test data

Sample inputs for manual testing. Open a file, copy everything, and paste it into the ParseBox input panel.

There is one folder per input format. The folder names match the format `value`s in `formatOptions` (`src/components/custom/SideBySideEditor.tsx`).

## Shared data sets

Many formats contain the same data, so you can compare conversions:

- **users**: 3 users (`id`, `name`, `email`, `role`, `active`, `age`). It is a flat list, so it also fits CSV, TSV, JSONL and TOON tables.
- **config**: a nested app config (`app`, `server`, `database`). It is an object at the root, so it also fits TOML, INI, dotenv and query strings.
- **order-nested**: an order with nested objects, a list of items, `null` and an empty string.

## Copy and paste rules

- ParseBox does not trim the input. The Base64, hex, binary, MessagePack, URI and query string files have **no trailing line break**. If your editor adds one, Base64 auto-detection fails and the hex reader gets an extra byte.
- The hex reader does not skip spaces or line breaks. Keep hex input as one unbroken string.
- The Base64, hex and binary readers convert one byte to one character. They do not decode UTF-8. These samples use ASCII only.
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
