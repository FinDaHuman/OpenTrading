import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/*
 * Static checks on import boundaries. They catch wrong wiring early; the real guard is that the write capability
 * is a separate object handed only to the TUI, not these scans.
 */
const ROOT = path.resolve(import.meta.dir, "../..")
const files = (pattern: string) =>
  [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })].map((f) => f.replace(/\\/g, "/")).sort()
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8")
const importsOf = (source: string) =>
  [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"`;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!)

/*
 * Temporary: the core's placeholder MemoryProvider contract and its reference FileMemory live in the same folder and
 * are wired into the agent loop and /memory directly. The memory rules below do not apply to them. Remove this
 * exception when the placeholder is retired.
 */
const CORE_PLACEHOLDER = ["src/core/memory/types.ts", "src/core/memory/file-memory.ts"]
const PLACEHOLDER_IMPORT = /memory\/(types|file-memory)$/
/** The adapter is the one memory file that speaks the harness contract. */
const ADAPTER = "src/core/memory/provider.ts"

const MEMORY = files("src/core/memory/**/*.ts").filter((f) => !CORE_PLACEHOLDER.includes(f))
const MEMORY_OWNED = [
  ...MEMORY,
  ...files("src/core/market/**/*.ts"),
  ...files("src/core/rules/**/*.ts"),
  ...files("src/core/context/**/*.ts"),
]

/** Where the capability root may be imported: tests, scripts (temp databases), and the one production root. */
const FACTORY_ALLOWED = [/^test\//, /^scripts\//, /^src\/core\/memory\//, /^src\/core\/memory-root\.ts$/]

const MEMORY_IMPORTS = new Set([
  "zod",
  "bun:sqlite",
  "node:crypto",
  "../market/tickers",
  "../rules/load",
  "../rules/match",
])
const ADAPTER_IMPORTS = new Set(["zod", "../hooks", "../tools/types", "./types"])

describe("memory module boundaries", () => {
  test("the memory module exists", () => {
    for (const f of ["index.ts", "service.ts", "provider.ts"]) expect(MEMORY).toContain(`src/core/memory/${f}`)
  })

  test("memory imports only its own files, zod, bun:sqlite, node:crypto and the market/rules modules", () => {
    for (const file of MEMORY)
      for (const spec of importsOf(read(file))) {
        const ok =
          (spec.startsWith("./") && !(file !== ADAPTER && /^\.\/(types|file-memory)$/.test(spec))) ||
          MEMORY_IMPORTS.has(spec) ||
          (file === ADAPTER && ADAPTER_IMPORTS.has(spec))
        expect({ file, spec, ok }).toEqual({ file, spec, ok: true })
      }
  })

  test("the adapter imports harness types only, never runtime code from the core", () => {
    const source = read(ADAPTER)
    for (const line of source
      .split("\n")
      .filter((l) => /from\s+"\.\.\/(hooks|tools\/types)"|from\s+"\.\/types"/.test(l)))
      expect(line.trimStart().startsWith("import type")).toBe(true)
  })

  test("memory, market, rules and context code never reach the real data directory, UI, chat, providers or auth", () => {
    for (const file of MEMORY_OWNED) {
      const source = read(file)
      for (const banned of ["paths", "../tui", "/tui/", "chat", "providers", "auth", "agent"])
        expect({ file, banned, found: importsOf(source).some((s) => s.includes(banned)) }).toEqual({
          file,
          banned,
          found: false,
        })
      expect({ file, dataDir: /DATA_DIR|OPENTRADING_HOME|dataDir\(/.test(source) }).toEqual({ file, dataDir: false })
    }
  })

  test("outside the module, code imports memory only through its index", () => {
    for (const file of files("src/**/*.{ts,tsx}").filter((f) => !f.startsWith("src/core/memory/")))
      for (const spec of importsOf(read(file)).filter((s) => /memory(\/|$)/.test(s) && !PLACEHOLDER_IMPORT.test(s)))
        expect({ file, spec, viaIndex: /memory(\/index)?$/.test(spec) }).toEqual({ file, spec, viaIndex: true })
  })

  test("only allowlisted places may use the capability root createMemoryService", () => {
    for (const file of files("{src,test,scripts}/**/*.{ts,tsx}")) {
      if (!read(file).includes("createMemoryService")) continue
      expect({ file, allowed: FACTORY_ALLOWED.some((re) => re.test(file)) }).toEqual({ file, allowed: true })
    }
  })

  test("the preview script never touches the real data directory", () => {
    const source = read("scripts/memory-preview.ts")
    expect(importsOf(source).some((s) => s.includes("paths") || s.includes("memory-root"))).toBe(false)
    expect(/DATA_DIR|OPENTRADING_HOME|dataDir\(/.test(source)).toBe(false)
  })

  test("the public index exports no write function other than the capability roots", async () => {
    const index = await import("../../src/core/memory")
    expect(Object.keys(index).sort()).toEqual([
      "createMemoryProvider",
      "createMemoryService",
      "parseMemoryConfig",
      "systemClock",
      "uuidV7Ids",
    ])
  })
})
