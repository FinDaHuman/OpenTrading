import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseCli } from "../src/cli/args"
import { Workspace } from "../src/core/fs/workspace"
import { judgeStop, unfetchedFigures } from "../src/core/loop/stop-gate"
import { assemble, type AssembleInput } from "../src/core/prompt/assemble"
import { ToolRegistry } from "../src/core/tools/registry"
import { shellTool, useCalculatorShell } from "../src/core/tools/shell/shell"

/** `--profile machine` (issue #278 P2/P3/P4/N3): the prompt and the shell for a program caller. */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-profile-"))
mkdirSync(path.join(root, "home", ".opentrading"), { recursive: true })
mkdirSync(path.join(root, "project"), { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  tier: "B",
  tools: ["current_time", "shell"],
  skills: [],
  sticky: [],
  input: "Trả lời JSON: giá đóng cửa HPG?",
  now: new Date("2026-11-13T10:00:00+07:00"),
  ...over,
})
const prompts = path.join(import.meta.dir, "..", "prompts")
/** How the tools.md lines that only serve a person watching a terminal begin. */
const TERMINAL_ONLY = ["- Talk about what you did", "- Before the first tool round or when changing direction"]

test("machine: no style guide, the machine citations, tools.md without the lines for a person watching", () => {
  const terminal = assemble(base())
  const machine = assemble(base({ profile: "machine" }))
  expect(terminal.system).toContain("<style>")
  expect(machine.system).not.toContain("<style>")
  expect(machine.system).toContain("Dates as YYYY-MM-DD")
  expect(machine.system).not.toContain("128.400đ")
  for (const start of TERMINAL_ONLY) {
    expect(terminal.system).toContain(start)
    expect(machine.system).not.toContain(start)
  }
  // The invariants, the priority order, the computing rule and the stop rule stay.
  for (const kept of ["<bat_bien>", "<thu_tu_uu_tien>", "No mental arithmetic", "Stop only when the answer is complete"]) expect(machine.system).toContain(kept)
  // What it saves on every request, in the chars/4 estimate the budget guard uses.
  const saved = Math.ceil(terminal.system.length / 4) - Math.ceil(machine.system.length / 4)
  expect(saved).toBeGreaterThan(800)
  expect(machine.report.find((l) => l.id === "citations")).toBeDefined()
})

test("the lines for a person watching are marked terminal-only in tools.md, and the stop rule is not", () => {
  const tools = readFileSync(path.join(prompts, "tools.md"), "utf8").split("\n")
  for (const start of TERMINAL_ONLY) expect([start, tools.filter((l) => l.startsWith(start) && l.endsWith("<!-- khi: terminal -->")).length]).toEqual([start, 1])
  expect(tools.filter((l) => l.startsWith("- Stop only when") && !l.includes("<!--")).length).toBe(1)
})

test("the stop gate accepts machine-format answers (dot decimals, ISO dates, no thousands separator): no recovery request", () => {
  const question = "Giá đóng cửa HPG ngày 30/09/2026 là 25.350 đồng, ngày 31/10/2026 là 27.100 đồng. Trả lời JSON."
  for (const text of [
    '{"value": 6.9034, "unit": "%"}',
    '{"eps": 6120, "unit": "VND"}',
    '{"contributions": {"A": 4.96, "B": -1.33, "C": 1.7875}, "total": 5.4175}',
    '{"date": "2026-10-31", "close": 96500, "change": 1300}',
    '{"symbol": "HPG", "period": "2026-Q3", "value": 1315800000000, "unit": "VND", "source": "vn_fundamentals", "asof": "2026-11-01"}',
    '```json\n{"value": 27100, "unit": "VND", "source": "vn_quote_history", "asof": "2026-10-31"}\n```',
    '[{"symbol":"FPT","pe":15.768},{"symbol":"HPG","pe":8.12}]',
  ]) {
    expect([text, judgeStop({ text, toolNames: [], finish: "stop", afterTools: true, toolsInTurn: true, dataInTurn: true, fetchedData: true, usableData: true }, [])]).toEqual([text, { action: "accept" }])
    const unfetched = unfetchedFigures(text, question).length
    expect([text, judgeStop({ text, toolNames: [], finish: "stop", toolsInTurn: false, dataInTurn: false, unfetched }, [])]).toEqual([text, { action: "accept" }])
  }
})

test("useCalculatorShell swaps in the arithmetic-only shell and puts the full one back", () => {
  const registry = new ToolRegistry()
  const full = shellTool(new Workspace(path.join(root, "project"), { home: path.join(root, "home"), data: path.join(root, "home", ".opentrading") }))
  registry.register(full)
  const restore = useCalculatorShell(registry)
  const swapped = registry.get("shell")!
  expect(swapped.description).toStartWith("Calculator")
  expect(swapped.readOnly).toBe(true)
  expect(swapped.description.length).toBeLessThan(full.description.length)
  restore()
  expect(registry.get("shell")).toBe(full)
  // No shell at all: nothing to swap.
  expect(() => useCalculatorShell(new ToolRegistry())()).not.toThrow()
})

test("parseCli: --profile machine with -p only; terminal is the default", () => {
  expect(parseCli(["-p", "x", "--profile", "machine"])).toEqual({ kind: "print", prompt: "x", format: "text", profile: "machine" })
  expect(parseCli(["-p", "x", "--profile", "terminal"])).toEqual({ kind: "print", prompt: "x", format: "text" })
  expect(parseCli(["-p", "x", "--profile", "json"]).kind).toBe("error")
  expect(parseCli(["-p", "x", "--profile"]).kind).toBe("error")
  expect(parseCli(["--profile", "machine"]).kind).toBe("error")
})

test("a prompt folder without citations-machine.md (a benchmark's own variant) still gets the bundled one", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const dir = path.join(root, "variant")
  mkdirSync(dir, { recursive: true })
  for (const id of ["identity", "tools", "citations", "style"]) writeFileSync(path.join(dir, `${id}.md`), readFileSync(path.join(prompts, `${id}.md`), "utf8"))
  const machine = assemble(base({ profile: "machine" }), dir)
  expect(machine.system).toContain("Dates as YYYY-MM-DD")
  expect(machine.system).not.toContain("<style>")
})
