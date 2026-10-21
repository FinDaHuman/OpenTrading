import { expect, test } from "bun:test"
import { generateText } from "ai"
import type { CatalogProvider } from "../src/core/catalog"
import { PLAYBOOKS } from "../src/core/desk/playbooks"
import { deskRunTool } from "../src/core/desk/tool"
import { toolSetOptions } from "../src/core/agent"
import { languageModel } from "../src/core/providers"
import { ToolRegistry } from "../src/core/tools/registry"

/** desk_run as Gemini receives it (no network: the request body is captured). */
async function geminiDeclaration() {
  const registry = new ToolRegistry()
  registry.register(deskRunTool({ engine: {} as never, approvals: {} as never, playbooks: () => PLAYBOOKS, optIn: () => "keyword", mode: () => "ask" }))
  const provider = { id: "google", name: "Google", env: [], npm: "@ai-sdk/google", models: { "gemini-3.1-flash-lite": { id: "gemini-3.1-flash-lite", name: "g", tool_call: true } } } as unknown as CatalogProvider
  const target = { provider, model: "gemini-3.1-flash-lite" }
  const built = registry.toToolSet({ ...toolSetOptions(target), loaded: new Set(["desk_run"]) })
  const realFetch = globalThis.fetch
  let sent: { tools?: { functionDeclarations?: { name: string; parameters?: Record<string, unknown>; parametersJsonSchema?: Record<string, unknown> }[] }[] } = {}
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    throw new Error("captured")
  }) as unknown as typeof fetch
  try {
    await generateText({ model: languageModel(provider, target.model, "x"), prompt: "hi", tools: built.tools, maxRetries: 0 }).catch(() => {})
  } finally {
    globalThis.fetch = realFetch
  }
  return sent.tools?.flatMap((t) => t.functionDeclarations ?? []).find((d) => d.name === "desk_run")
}

test("Gemini gets desk_run with a real object per playbook (no empty OBJECT it would reject)", async () => {
  const decl = await geminiDeclaration()
  expect(decl).toBeDefined()
  // @ai-sdk/google sends full JSON Schema (parametersJsonSchema), else the OpenAPI subset.
  const params = (decl!.parametersJsonSchema ?? decl!.parameters) as { properties: Record<string, { type?: string; properties?: Record<string, unknown> }> }
  for (const p of PLAYBOOKS) {
    const key = p.meta.name.replace(/-/g, "_")
    expect(params.properties[key]?.properties).toBeDefined()
    expect(Object.keys(params.properties[key]!.properties!).length).toBeGreaterThan(0)
  }
  // Nowhere an OBJECT without properties.
  const empty: string[] = []
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return
    const n = node as { type?: string; properties?: Record<string, unknown>; items?: unknown }
    if (String(n.type).toLowerCase() === "object" && (!n.properties || Object.keys(n.properties).length === 0)) empty.push(path)
    for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, `${path}.${k}`)
    if (n.items) walk(n.items, `${path}[]`)
  }
  walk(params, "desk_run")
  expect(empty).toEqual([])
})
