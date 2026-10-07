/**
 * Identifier helpers for the type emitters: split keys into words, change
 * case, singularise, and keep names unique.
 */

/** Splits a key into ASCII words: "orderId" → order, Id; "key with-spaces" → key, with, spaces */
export function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export function pascalCase(key: string): string {
  return words(key).map(capitalise).join("");
}

export function camelCase(key: string): string {
  const pascal = pascalCase(key);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function snakeCase(key: string): string {
  return words(key).map((word) => word.toLowerCase()).join("_");
}

const irregular: Record<string, string> = {
  people: "person",
  children: "child",
  men: "man",
  women: "woman",
  criteria: "criterion",
  movies: "movie",
  cookies: "cookie",
  series: "series",
  species: "species",
  news: "news",
  indices: "index",
  matrices: "matrix",
  vertices: "vertex",
};

/** Cheap English singular for type names: "categories" → "category", "addresses" → "address" */
export function singular(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "data") return word;
  const known = irregular[lower];
  if (known) return word.charAt(0) + known.slice(1);
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + (word.endsWith("S") ? "Y" : "y");
  if (/(ss|sh|ch|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/[a-z0-9]s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Hands out unique names: "Address", then "Address2", "Address3"... */
export class NameSet {
  private used = new Set<string>();

  constructor(reserved: Iterable<string> = []) {
    for (const name of reserved) this.used.add(name.toLowerCase());
  }

  take(base: string): string {
    let name = base;
    for (let n = 2; this.used.has(name.toLowerCase()); n++) name = `${base}${n}`;
    this.used.add(name.toLowerCase());
    return name;
  }
}

/** Builds an identifier for each key, unique within one type */
export function uniqueIdents(keys: string[], toIdent: (key: string) => string, reserved: Iterable<string> = []): string[] {
  const names = new NameSet(reserved);
  return keys.map((key) => names.take(toIdent(key)));
}

/** Prefixes identifiers that would start with a digit or be empty */
export function safeStart(ident: string, fallback: string, prefix: string): string {
  if (!ident) return fallback;
  return /^[0-9]/.test(ident) ? prefix + ident : ident;
}
