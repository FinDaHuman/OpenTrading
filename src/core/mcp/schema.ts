import type { JSONSchema7 } from "@ai-sdk/provider"

/**
 * Make an MCP tool's input schema acceptable to every provider we talk to.
 *
 * MCP servers send whatever JSON Schema their framework emits (Pydantic, zod, hand-written);
 * providers accept different subsets. Lessons from opencode (`provider/transform.ts`) and
 * Codex (`tools/src/json_schema.rs`):
 * - `$ref`/`$defs` must be inlined: @ai-sdk/google silently drops them, leaving `{}`.
 * - Arrays need `items`, `required` may only name declared properties, `const` → `enum`.
 * - Gemini only takes string enums and a couple of string formats.
 * - Very large schemas eat the context window; compact them.
 *
 * The walker only treats keys in *schema positions* as keywords. Keys inside a
 * `properties` map are parameter names — a parameter called `pattern`, `title` or
 * `description` must survive untouched.
 */

export type SchemaFlavor = "default" | "gemini"

type Node = Record<string, unknown>

const isObj = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v)

/** Keys whose value is a single sub-schema. */
const ONE = ["items", "additionalProperties", "not", "contains", "propertyNames", "if", "then", "else", "additionalItems", "unevaluatedProperties", "unevaluatedItems"]
/** Keys whose value is a list of sub-schemas. */
const MANY = ["anyOf", "oneOf", "allOf", "prefixItems"]
/** Keys whose value is a name → sub-schema map (the names are data, not keywords). */
const MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]

/** Keywords that only cost tokens: dropped everywhere. */
const NOISE = new Set(["$schema", "$id", "$anchor", "$comment", "title", "examples", "$defs", "definitions"])
/** Keywords Gemini rejects or that @ai-sdk/google would mangle. */
const GEMINI_DROP = new Set(["not", "if", "then", "else", "patternProperties", "propertyNames", "dependentSchemas", "contains", "unevaluatedProperties", "unevaluatedItems", "additionalItems"])
/** The only string formats Gemini accepts. */
const GEMINI_FORMATS = new Set(["enum", "date-time"])

/** Apply `fn` to every sub-schema of `node` (one level), returning a new node. */
function mapChildren(node: Node, fn: (child: unknown) => unknown): Node {
  const out: Node = { ...node }
  for (const key of ONE) {
    const v = node[key]
    if (Array.isArray(v) && key === "items") out[key] = v.map(fn)
    else if (isObj(v)) out[key] = fn(v)
  }
  for (const key of MANY) if (Array.isArray(node[key])) out[key] = (node[key] as unknown[]).map(fn)
  for (const key of MAP) {
    const v = node[key]
    if (isObj(v)) out[key] = Object.fromEntries(Object.entries(v).map(([name, child]) => [name, fn(child)]))
  }
  return out
}

/** Resolve local refs (`#/$defs/X`, `#/definitions/X`, `#`). External refs become `{}`. */
function inlineRefs(root: Node): Node {
  const defs: Record<string, unknown> = {
    ...(isObj(root.definitions) ? root.definitions : {}),
    ...(isObj(root.$defs) ? root.$defs : {}),
  }
  const lookup = (ref: string): unknown => {
    if (ref === "#") return root
    const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)
    return m ? defs[decodeURIComponent(m[1]!.replace(/~1/g, "/").replace(/~0/g, "~"))] : undefined
  }
  const walk = (node: unknown, stack: string[]): unknown => {
    if (!isObj(node)) return node
    if (typeof node.$ref === "string") {
      const ref = node.$ref
      const { $ref: _, ...siblings } = node
      const target = lookup(ref)
      // A cycle (or an external ref) cannot be inlined: leave an open object with a hint.
      if (!isObj(target) || stack.includes(ref)) {
        const description = [siblings.description, `(kiểu ${ref.split("/").pop()})`].filter(Boolean).join(" ")
        return { type: "object", description }
      }
      return walk({ ...target, ...siblings }, [...stack, ref])
    }
    return mapChildren(node, (child) => walk(child, stack))
  }
  return walk(root, []) as Node
}

function inferType(node: Node): string | undefined {
  if (isObj(node.properties) || Array.isArray(node.required)) return "object"
  if (node.items !== undefined || node.prefixItems !== undefined) return "array"
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const t = typeof node.enum[0]
    return t === "number" ? (node.enum.every((x) => Number.isInteger(x)) ? "integer" : "number") : t === "boolean" ? "boolean" : "string"
  }
  if (node.minimum !== undefined || node.maximum !== undefined) return "number"
  if (node.minLength !== undefined || node.maxLength !== undefined || node.pattern !== undefined || node.format !== undefined) return "string"
  return undefined
}

const hasType = (node: Node, t: string) => node.type === t || (Array.isArray(node.type) && node.type.includes(t))

/** Per-node clean-up; children are already clean. */
function cleanNode(input: unknown, flavor: SchemaFlavor): unknown {
  // `true` / `{}` = anything; `false` cannot be expressed usefully — treat as anything too.
  if (typeof input === "boolean") return {}
  if (!isObj(input)) return {}
  const node: Node = {}
  for (const [key, value] of Object.entries(input)) {
    if (NOISE.has(key)) continue
    if (flavor === "gemini" && GEMINI_DROP.has(key)) continue
    if (key === "const") {
      if (input.enum === undefined) node.enum = [value]
      continue
    }
    node[key] = value
  }

  const combinator = node.anyOf || node.oneOf || node.allOf
  if (node.type === undefined && !combinator) {
    const t = inferType(node)
    if (t) node.type = t
  }
  if (Array.isArray(node.required)) {
    const props = isObj(node.properties) ? node.properties : {}
    const kept = (node.required as unknown[]).filter((r): r is string => typeof r === "string" && r in props)
    if (kept.length > 0) node.required = kept
    else delete node.required
  }
  if (hasType(node, "object") && !combinator && node.properties === undefined && !isObj(node.additionalProperties)) {
    node.properties = {}
  }
  if (hasType(node, "array") && node.items === undefined && node.prefixItems === undefined) {
    node.items = flavor === "gemini" ? { type: "string" } : {}
  }

  if (flavor === "gemini") {
    // Tuples: Gemini wants one items schema.
    if (Array.isArray(node.items)) node.items = node.items[0] ?? { type: "string" }
    if (Array.isArray(node.prefixItems)) {
      node.items ??= node.prefixItems[0] ?? { type: "string" }
      delete node.prefixItems
    }
    // Gemini only takes string enums. Changing the type would make the model send "5"
    // where the server expects 5 — so drop the enum and say the allowed values instead.
    if (Array.isArray(node.enum) && node.enum.some((v) => typeof v !== "string")) {
      const values = node.enum.map((v) => JSON.stringify(v)).join(", ")
      node.description = [node.description, `Một trong: ${values}.`].filter(Boolean).join(" ")
      delete node.enum
    }
    if (typeof node.format === "string" && !GEMINI_FORMATS.has(node.format)) delete node.format
  }
  return node
}

function clean(node: unknown, flavor: SchemaFlavor): unknown {
  const cleaned = cleanNode(node, flavor)
  return isObj(cleaned) ? mapChildren(cleaned, (child) => clean(child, flavor)) : cleaned
}

/** Remove a keyword from every sub-schema (never from the root, never from `properties` names). */
function stripNested(node: Node, keys: string[], depth = 0): Node {
  const out = depth > 0 ? Object.fromEntries(Object.entries(node).filter(([k]) => !keys.includes(k))) : { ...node }
  return mapChildren(out, (child) => (isObj(child) ? stripNested(child, keys, depth + 1) : child))
}

/** Replace sub-schemas deeper than `max` with an open schema. */
function cutDepth(node: Node, max: number, flavor: SchemaFlavor, depth = 0): Node {
  return mapChildren(node, (child) => {
    if (!isObj(child)) return child
    if (depth + 1 > max) {
      if (child.type === "array") return { type: "array", items: flavor === "gemini" ? { type: "string" } : {} }
      return child.type ? { type: child.type } : {}
    }
    return cutDepth(child, max, flavor, depth + 1)
  })
}

/** Above this many characters a tool schema gets compacted. */
export const COMPACT_OVER_CHARS = 6000

export function sanitizeSchema(schema: unknown, flavor: SchemaFlavor = "default", compactOver = COMPACT_OVER_CHARS): JSONSchema7 {
  const root = isObj(schema) ? schema : {}
  let out = clean(inlineRefs(root), flavor) as Node
  // The root must be a plain object schema: several providers reject root
  // `additionalProperties` and combinators. A root union ("give path OR url") is flattened:
  // every variant's parameters become optional root parameters, so none is lost; `allOf`
  // parts all apply, so their `required` lists are kept too.
  delete out.additionalProperties
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const variants = out[key]
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      if (!isObj(variant)) continue
      if (isObj(variant.properties)) out.properties = { ...variant.properties, ...(isObj(out.properties) ? out.properties : {}) }
      if (key === "allOf" && Array.isArray(variant.required)) {
        out.required = [...new Set([...(Array.isArray(out.required) ? out.required : []), ...variant.required])]
      }
    }
    delete out[key]
  }
  if (Array.isArray(out.required)) {
    const props = isObj(out.properties) ? out.properties : {}
    out.required = out.required.filter((r) => typeof r === "string" && r in props)
    if ((out.required as unknown[]).length === 0) delete out.required
  }
  out.type = "object"
  if (!isObj(out.properties)) out.properties = {}

  const size = () => JSON.stringify(out).length
  if (size() > compactOver) out = stripNested(out, ["default"])
  if (size() > compactOver) out = stripNested(out, ["description"])
  if (size() > compactOver) out = cutDepth(out, 4, flavor)
  return out as JSONSchema7
}

/** Every property path in a schema (`a`, `a.b`, `a[].c`) — used to prove nothing was lost. */
export function propertyPaths(schema: unknown, prefix = ""): string[] {
  if (!isObj(schema)) return []
  const paths: string[] = []
  if (isObj(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${name}` : name
      paths.push(path, ...propertyPaths(child, path))
    }
  }
  if (isObj(schema.items)) paths.push(...propertyPaths(schema.items, `${prefix}[]`))
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[key])) for (const sub of schema[key] as unknown[]) paths.push(...propertyPaths(sub, prefix))
  }
  return [...new Set(paths)]
}
