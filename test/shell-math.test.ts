import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { PermissionGate } from "../src/core/permission"
import { mathOnlyCommand } from "../src/core/tools/shell/math"
import { shellArgs } from "../src/core/tools/shell/run"
import { shellTool } from "../src/core/tools/shell/shell"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-shell-math-"))
const data = path.join(root, "home", ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const win = process.platform === "win32"
const ws = () => new Workspace(project, { home: path.join(root, "home"), data })
const PS = { kind: "powershell" as const }
const BASH = { kind: "bash" as const }
const ctx = () => ({ signal: new AbortController().signal, callId: "m" })
const text = (r: string | { output: string }) => (typeof r === "string" ? r : r.output)

// ── grammar ────────────────────────────────────────────────────────────────

const PS_OK = [
  "3/2",
  "(128.4/112-1)*100",
  "[math]::Round(31250/4520, 2)",
  "[math]::Pow(1.08, 3); [math]::Sqrt(2)",
  "-5 + +3 * (2 - 1)",
  "1 - -2",
  "2.5e12/4e8; 1.5E-3*2;",
  "[Math]::ROUND([math]::Max(1, 2) / 3, 4)",
  "(1+2) % 2",
  ".5*2",
]
const AWK_OK = [
  String.raw`awk 'BEGIN{printf "%.2f\n", (128.4/112-1)*100}'`,
  String.raw`awk 'BEGIN{printf "%.2f %.4f\n", 1.08^3, sqrt(2)}'`,
  String.raw`awk 'BEGIN { printf "pe=%.1f; cagr=%.2f\n", 31250/4520, (2.1/1.5)^(1/3)-1 }'`,
  String.raw`awk 'BEGIN{printf "%d\n", int(7/2)}'`,
]

test("PowerShell: bare arithmetic, ; between expressions, [math]:: functions", () => {
  for (const c of PS_OK) expect(mathOnlyCommand(c, PS), c).toBe(true)
})

test("PowerShell: arrays, ranges, variables, other types, invocation and chaining are not arithmetic", () => {
  for (const c of [
    "1,2*3", // an array repeated
    "2*3,4*5",
    "(1,2)*1e9",
    "1..3",
    "1..999999999",
    "$x*2",
    "$x = 5; $x*2",
    ". (1)",
    "&(1)",
    "`1+1",
    "[IO.File]::ReadAllText('a')",
    "[System.Math]::Round(1)",
    "[math]::Round(1)|Out-File x",
    "1 > x",
    "iex '1+1'",
    "Invoke-Expression 1",
    "powershell -EncodedCommand AAA",
    "1kb*2",
    "0x10+1",
    "1d",
    "5 -band 3",
    "1+1\nRemove-Item x",
    "1 − 2", // U+2212 minus
    "１+１", // full-width digits
    "1e999",
    "1--2", // decrement: a parse error on a number
    "1++2",
    "--1",
    "",
    ";",
    "()",
    "[math]::Round()",
    "[math]::Round 1",
    "Get-Date",
    "(1+2",
    `${"1+".repeat(300)}1`,
    Array.from({ length: 21 }, () => "1").join(";"),
  ]) expect(mathOnlyCommand(c, PS), c).toBe(false)
})

test("POSIX: awk BEGIN with printf only; print, files, system, getline and bare expressions are not", () => {
  for (const c of AWK_OK) expect(mathOnlyCommand(c, BASH), c).toBe(true)
  for (const c of [
    "1/2", // runs a file under bash
    "(1+2)", // a subshell
    "echo $((1+2))",
    "echo 1+2 | bc",
    String.raw`awk 'BEGIN{print (128.4/112-1)*100}'`, // six significant digits
    String.raw`awk 'BEGIN{printf "%.2f\n", 1}' /etc/passwd`,
    String.raw`awk 'BEGIN{printf "%.2f\n", system("id")}'`,
    String.raw`awk 'BEGIN{printf "%.2f\n", x}'`,
    String.raw`awk 'BEGIN{getline l < "/etc/passwd"; printf "%s\n", l}'`,
    String.raw`awk 'BEGIN{printf "%.2f %.2f\n", 1}'`, // conversions ≠ arguments
    String.raw`awk 'BEGIN{printf "%s\n", 1}'`,
    String.raw`awk 'BEGIN{printf "%.2f\n", 1}'; rm x`,
    String.raw`awk "BEGIN{printf \"%.2f\n\", 1}"`,
    String.raw`gawk 'BEGIN{printf "%.2f\n", 1}'`,
    String.raw`awk '{printf "%.2f\n", $1}'`,
    String.raw`python -c "print(1+2)"`,
    String.raw`node -e "console.log(1+2)"`,
  ]) expect(mathOnlyCommand(c, BASH), c).toBe(false)
  // Each form belongs to its shell.
  expect(mathOnlyCommand("3/2", BASH)).toBe(false)
  expect(mathOnlyCommand(String.raw`awk 'BEGIN{printf "%.2f\n", 1}'`, PS)).toBe(false)
})

// ── permission ─────────────────────────────────────────────────────────────

test("arithmetic gets the math: scope (in the workspace only); anything else keeps its scope", () => {
  const ps = shellTool(ws(), { shell: { kind: "powershell", path: "powershell" } })
  expect(ps.askFor?.({ command: " (128.4/112-1)*100 " })).toBe("math:(128.4/112-1)*100")
  expect(ps.askFor?.({ command: "3/2", workdir: root })).toBe(`outside:${root}`)
  expect(ps.askFor?.({ command: "$x*2" })).toStartWith("cmd")
  expect(ps.description).toContain("[math]::Round")
  const sh = shellTool(ws(), { shell: { kind: "bash", path: "bash" } })
  expect(sh.askFor?.({ command: String.raw`awk 'BEGIN{printf "%.2f\n", 1/3}'` })).toStartWith("math:")
  expect(sh.description).toContain("awk 'BEGIN{printf")
})

test("arithmetic runs in every mode without a prompt, also headless; deny and ask rules still apply", async () => {
  const tool = shellTool(ws(), { shell: { kind: "powershell", path: "powershell" } })
  const signal = new AbortController().signal
  let reviews = 0
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  // Not interactive: a call that had to ask would come back "headless".
  for (const mode of ["read-only", "ask", "bypass"] as const) {
    gate.bypassAvailable = true
    gate.setMode(mode)
    expect(await gate.check(tool, { command: "[math]::Round(31250/4520, 2)" }, signal)).toEqual({ allow: true })
    expect((await gate.check(tool, { command: "$x*2" }, signal)).allow).toBe(mode === "bypass")
  }
  // ▸▸ auto: no classifier request for arithmetic.
  ;(gate as unknown as { auto: unknown }).auto = {
    log: { action() {}, denied() {}, approved() {} },
    ranWithoutBlock() {},
    review: async () => {
      reviews++
      return { decision: "ask", why: "test" }
    },
  }
  gate.setMode("auto")
  expect(await gate.check(tool, { command: "3/2" }, signal)).toEqual({ allow: true })
  expect(reviews).toBe(0)

  const ruled = new PermissionGate({
    load: async () => [],
    save: async () => {},
    lists: async () => ({ deny: [{ tool: "shell", pattern: "*Pow*" }], ask: [{ tool: "shell", pattern: "*Sqrt*" }] }),
  })
  await ruled.refreshRules()
  ruled.setMode("ask")
  expect(await ruled.check(tool, { command: "[math]::Pow(2, 3)" }, signal)).toMatchObject({ allow: false, reason: "rule" })
  expect(await ruled.check(tool, { command: "[math]::Sqrt(2)" }, signal)).toMatchObject({ allow: false, reason: "headless" })
  expect(await ruled.check(tool, { command: "3/2" }, signal)).toEqual({ allow: true })
})

// ── running ────────────────────────────────────────────────────────────────

test("PowerShell arithmetic is printed in the invariant culture (vi-VN would print 1,5)", async () => {
  const script = (command: string) => {
    const args = shellArgs({ kind: "powershell", path: "powershell" }, command)
    return Buffer.from(args.at(-1)!, "base64").toString("utf16le")
  }
  expect(script("3/2")).toContain("InvariantCulture")
  expect(script("Get-Date")).not.toContain("InvariantCulture")
  // POSIX: the C locale, so printf never writes a decimal comma.
  expect(shellArgs({ kind: "bash", path: "bash" }, AWK_OK[0]!).at(-1)).toBe(`LC_ALL=C ${AWK_OK[0]}`)
  expect(shellArgs({ kind: "bash", path: "bash" }, "ls").at(-1)).toBe("ls")
  if (!win) return
  const tool = shellTool(ws())
  const out = text(await tool.execute({ command: "3/2; [math]::Round(31250/4520, 2); (128.4/112-1)*100" }, ctx()))
  expect(out).toContain("mã thoát 0")
  expect(out).toContain("1.5")
  expect(out).toContain("6.91")
  expect(out).toContain("14.642857142857")
  // The same setting holds after a vi-VN culture (the thread culture persists inside one script).
  const legacy = Bun.which("powershell")
  if (legacy) {
    const proc = Bun.spawn([legacy, "-NoProfile", "-NonInteractive", "-Command", "[System.Threading.Thread]::CurrentThread.CurrentCulture='vi-VN'; & { 3/2 } | Out-String -Stream; [System.Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::InvariantCulture; & { 3/2 } | Out-String -Stream"], { stdout: "pipe" })
    const lines = (await new Response(proc.stdout).text()).trim().split(/\r?\n/)
    expect(lines).toEqual(["1,5", "1.5"])
  }
}, 30_000)

test("awk arithmetic runs under a POSIX shell", async () => {
  if (win || !Bun.which("awk")) return
  const tool = shellTool(ws())
  const out = text(await tool.execute({ command: String.raw`awk 'BEGIN{printf "%.2f %.2f\n", 2.5e12/3, 1.08^3}'` }, ctx()))
  expect(out).toContain("833333333333.33 1.26")
}, 30_000)

test("every accepted form really runs in this machine's shell and prints only numbers", async () => {
  const tool = shellTool(ws())
  const cases = win ? PS_OK : Bun.which("awk") ? AWK_OK : []
  for (const command of cases) {
    const out = text(await tool.execute({ command }, ctx()))
    expect(out, command).toContain("mã thoát 0")
    expect(out.split(/\r?\n/).slice(1).join(" "), command).toMatch(/^[\s\d.=;:a-z+-]+$/i)
  }
}, 60_000)

test("through runTool with a read-only, non-interactive gate: arithmetic runs, other commands are refused", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.setMode("read-only")
  const tool = shellTool(ws())
  const command = win ? "[math]::Round(31250/4520, 2)" : String.raw`awk 'BEGIN{printf "%.2f\n", 31250/4520}'`
  expect(text(await runTool(tool, { command }, ctx(), new RwLock(), gate))).toContain("6.91")
  await expect(runTool(tool, { command: win ? "Get-Date" : "date" }, ctx(), new RwLock(), gate)).rejects.toThrow()
}, 30_000)
