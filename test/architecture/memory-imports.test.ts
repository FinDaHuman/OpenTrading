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

const MEMORY = files("src/core/memory/**/*.ts")

/**
 * Where the capability root may be imported. V0B adds exactly one production composition root to this list.
 */
const FACTORY_ALLOWED = [/^test\//, /^scripts\//, /^src\/core\/memory\//]

describe("memory module boundaries", () => {
  test("the memory module exists", () => {
    expect(MEMORY).toContain("src/core/memory/index.ts")
    expect(MEMORY).toContain("src/core/memory/service.ts")
  })

  test("memory imports only its own files, zod and bun:sqlite", () => {
    for (const file of MEMORY)
      for (const spec of importsOf(read(file)))
        expect({ file, spec, ok: spec.startsWith("./") || spec === "zod" || spec === "bun:sqlite" }).toEqual({
          file,
          spec,
          ok: true,
        })
  })

  test("memory never reaches for the real data directory, the UI, chat, providers or auth", () => {
    for (const file of MEMORY) {
      const source = read(file)
      for (const banned of ["DATA_DIR", "OPENTRADING_HOME", "paths", "../tui", "chat", "providers", "auth"])
        expect({ file, banned, found: importsOf(source).some((s) => s.includes(banned)) }).toEqual({
          file,
          banned,
          found: false,
        })
      expect({ file, dataDir: /DATA_DIR|OPENTRADING_HOME/.test(source) }).toEqual({ file, dataDir: false })
    }
  })

  test("outside the module, code imports memory only through its index", () => {
    for (const file of files("src/**/*.{ts,tsx}").filter((f) => !f.startsWith("src/core/memory/")))
      for (const spec of importsOf(read(file)).filter((s) => s.includes("memory")))
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
    expect(importsOf(source).some((s) => s.includes("paths"))).toBe(false)
    expect(/DATA_DIR|OPENTRADING_HOME/.test(source)).toBe(false)
  })

  test("the public index exports no write function other than the capability root", async () => {
    const index = await import("../../src/core/memory")
    const runtime = Object.keys(index).sort()
    expect(runtime).toEqual(["createMemoryService", "parseMemoryConfig", "systemClock", "uuidV7Ids"])
  })
})
