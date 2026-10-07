/**
 * Type inference for the type emitters.
 *
 * One pass over the parsed value counts what each position holds (a Shape).
 * Arrays are sampled: only the first `sampleItems` items are read, so nothing
 * is copied and large arrays cost the same as small ones. The shapes then
 * become a Model: named object types (deduplicated by structure) and type
 * references the emitters print.
 */
import { NameSet, pascalCase, safeStart, singular } from "./names.ts";

/** What inference saw at one position of the value */
interface Shape {
  seen: number;
  nulls: number;
  bools: number;
  ints: number;
  floats: number;
  strings: number;
  /** Strings that are RFC 3339 date-times */
  dates: number;
  /** Values that are not JSON (functions, too deep...) */
  others: number;
  /** Largest absolute integer */
  maxInt: number;
  arrays: number;
  items: Shape | null;
  objects: number;
  fields: Map<string, Shape> | null;
}

export type TypeKind = "any" | "null" | "bool" | "int" | "float" | "string" | "array" | "map" | "object" | "union";

export interface TypeRef {
  kind: TypeKind;
  /** null was seen next to other values */
  nullable: boolean;
  /** int: needs more than 32 bits */
  big?: boolean;
  /** string: every sample was an RFC 3339 date-time */
  date?: boolean;
  /** array: the item type. map: the value type. */
  items?: TypeRef;
  /** object */
  def?: ObjectDef;
  /** union: two or more non-null member types */
  members?: TypeRef[];
}

export interface Field {
  key: string;
  type: TypeRef;
  /** The key was missing from some objects */
  optional: boolean;
}

export interface ObjectDef {
  name: string;
  fields: Field[];
}

export interface Model {
  root: TypeRef;
  /** Named object types, each after the types it uses (the root's type last) */
  defs: ObjectDef[];
  /** Named object types in reading order (the root's type first) */
  defsTopDown: ObjectDef[];
  /** False when union members are not printed (see withoutUnions) */
  unions: boolean;
}

export interface SampleInfo {
  /** Arrays that had more items than the cap */
  sampledArrays: number;
  /** Item count of the largest sampled array */
  largestLength: number;
  sampleItems: number;
}

/** Deeper values are typed as "any" */
const MAX_DEPTH = 64;
/** Objects with more keys than this are typed as maps */
const MAP_MIN_KEYS = 200;
const INT32_MAX = 2_147_483_647;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
/** Keys that are ids rather than names: "1", "42", UUIDs */
const ID_KEY = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Type names that clash with built-in types in one of the target languages */
const RESERVED_TYPE_NAMES = new Set([
  "Any", "Array", "BaseModel", "Bool", "Boolean", "Box", "Byte", "Char", "Character", "Codable", "Data", "Date",
  "Decimal", "Dict", "Double", "Duration", "Error", "Field", "Float", "Function", "Int", "Int32", "Int64", "Integer",
  "JSONValue", "List", "ListValue", "Long", "Map", "Nothing", "Number", "Object", "Option", "Optional", "Promise",
  "Record", "Result", "RootModel", "Self", "Set", "String", "Struct", "Symbol", "Timestamp", "Type", "Union", "Unit",
  "Value", "Vec", "Void",
]);

const newShape = (): Shape => ({
  seen: 0, nulls: 0, bools: 0, ints: 0, floats: 0, strings: 0, dates: 0, others: 0, maxInt: 0,
  arrays: 0, items: null, objects: 0, fields: null,
});

/** Builds the model of `value`, reading at most `sampleItems` items of each array */
export function buildModel(value: unknown, sampleItems: number): { model: Model; sample: SampleInfo } {
  const sample: SampleInfo = { sampledArrays: 0, largestLength: 0, sampleItems };
  const root = newShape();
  addValue(root, value, 0, sample);
  return { model: resolveModel(root), sample };
}

function addValue(shape: Shape, value: unknown, depth: number, sample: SampleInfo): void {
  shape.seen++;
  if (value === null || value === undefined) {
    shape.nulls++;
    return;
  }
  // Dates and other objects with a JSON form are typed as that form, as JSON output would show them
  if (typeof value === "object" && depth < MAX_DEPTH && !Array.isArray(value) && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    shape.seen--;
    addValue(shape, (value as { toJSON: () => unknown }).toJSON(), depth + 1, sample);
    return;
  }
  switch (typeof value) {
    case "boolean":
      shape.bools++;
      return;
    case "number":
      // 6.022e23 is an integer to JavaScript but not to an int64
      if (Number.isSafeInteger(value)) {
        shape.ints++;
        const abs = Math.abs(value);
        if (abs > shape.maxInt) shape.maxInt = abs;
      } else {
        shape.floats++;
      }
      return;
    case "bigint":
      shape.ints++;
      shape.maxInt = Infinity;
      return;
    case "string":
      // Stop testing once one string is not a date-time
      if (shape.dates === shape.strings && DATE_TIME.test(value)) shape.dates++;
      shape.strings++;
      return;
    case "object":
      break;
    default:
      shape.others++;
      return;
  }
  if (depth >= MAX_DEPTH || ArrayBuffer.isView(value)) {
    shape.others++;
    return;
  }

  if (Array.isArray(value)) {
    shape.arrays++;
    const items = (shape.items ??= newShape());
    const count = Math.min(value.length, sample.sampleItems);
    if (value.length > count) {
      sample.sampledArrays++;
      if (value.length > sample.largestLength) sample.largestLength = value.length;
    }
    for (let i = 0; i < count; i++) addValue(items, value[i], depth + 1, sample);
    return;
  }

  shape.objects++;
  const fields = (shape.fields ??= new Map());
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    let field = fields.get(key);
    if (!field) fields.set(key, (field = newShape()));
    addValue(field, record[key], depth + 1, sample);
  }
}

/** Adds the counts of `from` into `into` (used when an object turns out to be a map) */
function mergeShape(into: Shape, from: Shape): void {
  into.seen += from.seen;
  into.nulls += from.nulls;
  into.bools += from.bools;
  into.ints += from.ints;
  into.floats += from.floats;
  // Date-ness holds only while every string so far is a date
  into.dates = into.dates === into.strings && from.dates === from.strings ? into.dates + from.dates : 0;
  into.strings += from.strings;
  into.others += from.others;
  into.maxInt = Math.max(into.maxInt, from.maxInt);
  into.arrays += from.arrays;
  if (from.items) mergeShape((into.items ??= newShape()), from.items);
  into.objects += from.objects;
  if (from.fields) {
    const fields = (into.fields ??= new Map());
    for (const [key, shape] of from.fields) {
      let field = fields.get(key);
      if (!field) fields.set(key, (field = newShape()));
      mergeShape(field, shape);
    }
  }
}

interface ResolveContext {
  names: NameSet;
  /** Object types by structure, so equal objects share one type */
  bySignature: Map<string, ObjectDef>;
  defs: ObjectDef[];
}

function resolveModel(root: Shape): Model {
  const ctx: ResolveContext = { names: new NameSet([...RESERVED_TYPE_NAMES, "Root"]), bySignature: new Map(), defs: [] };
  const rootType = resolve(root, "Root", ctx, true);
  return { root: rootType, defs: ctx.defs, defsTopDown: topDown(rootType, true), unions: true };
}

const ANY: TypeRef = { kind: "any", nullable: false };

function resolve(shape: Shape, hint: string, ctx: ResolveContext, isRoot = false): TypeRef {
  if (shape.others > 0 || shape.seen === 0) return ANY;
  const members: TypeRef[] = [];
  if (shape.bools) members.push({ kind: "bool", nullable: false });
  if (shape.floats) members.push({ kind: "float", nullable: false });
  else if (shape.ints) members.push({ kind: "int", nullable: false, big: shape.maxInt > INT32_MAX });
  if (shape.strings) members.push({ kind: "string", nullable: false, date: shape.dates === shape.strings });
  if (shape.arrays) members.push(resolveArray(shape, hint, ctx, isRoot));
  if (shape.objects) members.push(resolveObject(shape, hint, ctx, isRoot));

  const nullable = shape.nulls > 0;
  if (members.length === 0) return { kind: "null", nullable: true };
  if (members.length === 1) return { ...members[0], nullable };
  return { kind: "union", nullable, members };
}

function resolveArray(shape: Shape, hint: string, ctx: ResolveContext, isRoot: boolean): TypeRef {
  const items = shape.items!;
  const itemHint = isRoot ? "RootItem" : singular(hint) !== hint ? singular(hint) : `${hint}Item`;
  return { kind: "array", nullable: false, items: resolve(items, itemHint, ctx) };
}

function resolveObject(shape: Shape, hint: string, ctx: ResolveContext, isRoot: boolean): TypeRef {
  const fields = shape.fields!;
  if (fields.size === 0) return { kind: "map", nullable: false, items: ANY };

  // Objects keyed by ids ({"1": {...}, "2": {...}}) or with very many keys are maps
  const keys = [...fields.keys()];
  if (fields.size > MAP_MIN_KEYS || (fields.size > 1 && keys.every((key) => ID_KEY.test(key)))) {
    const values = newShape();
    for (const field of fields.values()) mergeShape(values, field);
    return { kind: "map", nullable: false, items: resolve(values, singular(hint) !== hint ? singular(hint) : `${hint}Value`, ctx) };
  }

  const resolved: Field[] = keys.map((key) => {
    const field = fields.get(key)!;
    return { key, type: resolve(field, key, ctx), optional: field.seen < shape.objects };
  });

  const signature = resolved.map((field) => `${JSON.stringify(field.key)}${field.optional ? "?" : ""}:${typeSignature(field.type)}`).join(",");
  let def = isRoot ? undefined : ctx.bySignature.get(signature);
  if (!def) {
    const base = safeStart(pascalCase(hint), "Type", "T");
    const name = isRoot ? "Root" : ctx.names.take(RESERVED_TYPE_NAMES.has(base) ? `${base}Object` : base);
    def = { name, fields: resolved };
    ctx.bySignature.set(signature, def);
    ctx.defs.push(def);
  }
  return { kind: "object", nullable: false, def };
}

function typeSignature(type: TypeRef): string {
  const nullable = type.nullable ? "|null" : "";
  switch (type.kind) {
    case "int":
      return (type.big ? "int64" : "int") + nullable;
    case "string":
      return (type.date ? "date" : "string") + nullable;
    case "array":
      return `[${typeSignature(type.items!)}]${nullable}`;
    case "map":
      return `{${typeSignature(type.items!)}}${nullable}`;
    case "object":
      return `#${type.def!.name}${nullable}`;
    case "union":
      return `(${type.members!.map(typeSignature).join("|")})${nullable}`;
    default:
      return type.kind + nullable;
  }
}

/** The named types in the order a reader meets them, starting from the root */
function topDown(root: TypeRef, unions: boolean): ObjectDef[] {
  const out: ObjectDef[] = [];
  const seen = new Set<ObjectDef>();
  const visit = (type: TypeRef) => {
    if (type.def && !seen.has(type.def)) {
      seen.add(type.def);
      out.push(type.def);
      for (const field of type.def.fields) visit(field.type);
    }
    if (type.items) visit(type.items);
    if (type.members && unions) type.members.forEach(visit);
  };
  visit(root);
  return out;
}

/**
 * The model for languages without union types, which print unions as their
 * "any" type: object types used only inside unions are left out.
 */
export function withoutUnions(model: Model): Model {
  const defsTopDown = topDown(model.root, false);
  const keep = new Set(defsTopDown);
  return { root: model.root, defs: model.defs.filter((def) => keep.has(def)), defsTopDown, unions: false };
}

/** True when any type the model prints matches `test` */
export function modelUses(model: Model, test: (type: TypeRef) => boolean): boolean {
  const walk = (type: TypeRef): boolean =>
    test(type) || (!!type.items && walk(type.items)) || (model.unions && !!type.members && type.members.some(walk));
  return walk(model.root) || model.defs.some((def) => def.fields.some((field) => walk(field.type)));
}
