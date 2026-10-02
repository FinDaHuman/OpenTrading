import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { propertyPaths, sanitizeSchema } from "../src/core/mcp/schema"

const DIR = path.join(import.meta.dir, "fixtures/mcp-schemas")
const fixtures = readdirSync(DIR).map(
  (f) =>
    JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as {
      server: string
      source: string
      tools: { name: string; inputSchema: unknown }[]
    },
)

/** Every keyword at a schema position (keys inside `properties` maps are names, not keywords). */
function keywords(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return acc
  for (const [k, v] of Object.entries(node)) {
    acc.add(k)
    if (k === "properties" && v && typeof v === "object") for (const child of Object.values(v)) keywords(child, acc)
    else if (["items", "additionalProperties", "not"].includes(k)) Array.isArray(v) ? v.forEach((c) => keywords(c, acc)) : keywords(v, acc)
    else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(k) && Array.isArray(v)) v.forEach((c) => keywords(c, acc))
  }
  return acc
}

function* schemas(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return
  const n = node as Record<string, unknown>
  yield n
  for (const [k, v] of Object.entries(n)) {
    if (k === "properties" && v && typeof v === "object") for (const c of Object.values(v)) yield* schemas(c)
    else if (["items", "additionalProperties"].includes(k)) yield* schemas(v)
    else if (["anyOf", "oneOf", "allOf"].includes(k) && Array.isArray(v)) for (const c of v) yield* schemas(c)
  }
}

test("fixtures are the real captures", () => {
  expect(fixtures.map((f) => f.server).sort()).toEqual(["context7", "filesystem", "opentrading", "playwright"])
  expect(fixtures.every((f) => f.source === "captured")).toBe(true)
})

test("real server schemas: no property is ever lost, for both flavors", () => {
  let checked = 0
  for (const fx of fixtures) {
    for (const tool of fx.tools) {
      const before = propertyPaths(tool.inputSchema)
      for (const flavor of ["default", "gemini"] as const) {
        const id = `${fx.server}/${tool.name}/${flavor}`
        expect({ id, paths: propertyPaths(sanitizeSchema(tool.inputSchema, flavor)) }).toEqual({ id, paths: before })
        // Compaction strips descriptions and defaults but must keep every shallow parameter.
        const compact = propertyPaths(sanitizeSchema(tool.inputSchema, flavor, 0))
        for (const p of before.filter((p) => p.split(/\.|\[\]/).length <= 3)) expect({ id, has: compact.includes(p) }).toEqual({ id, has: true })
        checked++
      }
    }
  }
  expect(checked).toBe(2 * fixtures.reduce((n, f) => n + f.tools.length, 0))
})

test("real server schemas come out provider-safe", () => {
  for (const fx of fixtures) {
    for (const tool of fx.tools) {
      for (const flavor of ["default", "gemini"] as const) {
        const out = sanitizeSchema(tool.inputSchema, flavor)
        expect(out.type).toBe("object")
        expect(out.additionalProperties).toBeUndefined()
        const kws = keywords(out)
        for (const k of ["$schema", "$ref", "$defs", "title", "const"]) expect(kws.has(k)).toBe(false)
        for (const node of schemas(out)) {
          if (node.type === "array") expect(node.items).toBeDefined()
          if (Array.isArray(node.required)) for (const r of node.required) expect(Object.keys(node.properties as object)).toContain(r)
          if (flavor === "gemini" && Array.isArray(node.enum)) expect(node.enum.every((v) => typeof v === "string")).toBe(true)
        }
      }
    }
  }
})

test("parameters named like keywords survive (pattern, title, description, default)", () => {
  const schema = {
    type: "object",
    title: "Args",
    properties: {
      pattern: { type: "string", title: "Pattern" },
      title: { type: "string" },
      description: { type: "string", description: "Mô tả issue" },
      default: { type: "boolean" },
    },
    required: ["pattern", "title", "ghost"],
  }
  for (const flavor of ["default", "gemini"] as const) {
    const out = sanitizeSchema(schema, flavor, 0) as Record<string, any>
    expect(Object.keys(out.properties)).toEqual(["pattern", "title", "description", "default"])
    expect(out.required).toEqual(["pattern", "title"])
    expect(out.title).toBeUndefined()
    expect(out.properties.pattern.title).toBeUndefined()
  }
})

test("synthetic: $ref (incl. cycles) is inlined, const becomes enum, tuples and arrays get items", () => {
  // Shape modelled on Notion/GitHub-style generated schemas (hand-written, not captured).
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      parent: { $ref: "#/$defs/Parent", description: "Trang cha" },
      node: { $ref: "#/definitions/Node" },
      kind: { const: "page" },
      tags: { type: "array" },
      pair: { type: "array", items: [{ type: "string" }, { type: "number" }] },
      when: { type: "string", format: "uri" },
    },
    $defs: { Parent: { type: "object", properties: { page_id: { type: "string" } }, required: ["page_id"] } },
    definitions: { Node: { type: "object", properties: { child: { $ref: "#/definitions/Node" } } } },
  }
  const out = sanitizeSchema(schema) as Record<string, any>
  expect(out.properties.parent).toEqual({ type: "object", properties: { page_id: { type: "string" } }, required: ["page_id"], description: "Trang cha" })
  expect(out.properties.node.properties.child).toMatchObject({ type: "object" }) // the cycle stops here
  expect(out.properties.kind).toEqual({ enum: ["page"], type: "string" })
  expect(out.properties.tags.items).toEqual({})
  expect(JSON.stringify(out)).not.toContain("$ref")

  const gemini = sanitizeSchema(schema, "gemini") as Record<string, any>
  expect(gemini.properties.tags.items).toEqual({ type: "string" })
  expect(gemini.properties.pair.items).toEqual({ type: "string" })
  expect(gemini.properties.when.format).toBeUndefined()
})

test("Gemini: non-string enums keep their type and move into the description", () => {
  const out = sanitizeSchema({ type: "object", properties: { level: { type: "integer", enum: [1, 2, 3], description: "Mức" } } }, "gemini") as Record<string, any>
  expect(out.properties.level).toEqual({ type: "integer", description: "Mức Một trong: 1, 2, 3." })
  const plain = sanitizeSchema({ type: "object", properties: { level: { type: "integer", enum: [1, 2] } } }) as Record<string, any>
  expect(plain.properties.level.enum).toEqual([1, 2])
})

test("oversized schemas are compacted without losing parameters", () => {
  const properties = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { type: "string", description: "x".repeat(200), default: "d" }]))
  const out = sanitizeSchema({ type: "object", properties })
  expect(JSON.stringify(out).length).toBeLessThan(6000)
  expect(Object.keys(out.properties!)).toHaveLength(40)
})
