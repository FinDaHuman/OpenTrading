import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { PermissionGate } from "../src/core/permission"
import { mathNearMiss, mathOnlyCommand } from "../src/core/tools/shell/math"
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
  // Variables assigned earlier in the command, one statement a line or after ;
  "$x = 5; $x*2",
  "$k = 250/119\n$stb = [math]::Log(66.3/73.5)*$k\n[math]::Round($stb, 4)",
  "$Tong = 1+2; $tong += 3; $TONG / 2 # tên biến không phân biệt hoa thường",
  "# lợi suất\n$g = 128.4/112 - 1\n\n$g*100;;",
]
const AWK_OK = [
  String.raw`awk 'BEGIN{printf "%.2f\n", (128.4/112-1)*100}'`,
  String.raw`awk 'BEGIN{printf "%.2f %.4f\n", 1.08^3, sqrt(2)}'`,
  String.raw`awk 'BEGIN { printf "pe=%.1f; cagr=%.2f\n", 31250/4520, (2.1/1.5)^(1/3)-1 }'`,
  String.raw`awk 'BEGIN{printf "%d\n", int(7/2)}'`,
  // Issue #268: the forms the model really wrote, all sent to the approval gate before.
  String.raw`awk 'BEGIN{x=5; printf "%.2f\n", x*2}'`,
  String.raw`awk 'BEGIN { printf("%.2f\n", 1/3) }'`,
  String.raw`awk 'BEGIN{k=250/119; a=log(66.3/73.5)*k; printf "%.4f\n", a}'`,
  "awk 'BEGIN{\nk=250/119;\nstb=log(66.3/73.5)*k; mwg=log(74.0/81.33)*k;\nprintf \"%.4f %.4f\\n\", stb, mwg\n}'",
  String.raw`awk 'BEGIN{printf "%.0f\n%.0f\n%8.2f\t%-6.1e\n", 1e9/3, 2e9/3, 1.5, 2.5}'`,
  String.raw`awk 'BEGIN{print (128.4/112-1)*100}'`,
  String.raw`awk 'BEGIN{ a = 3; b = 4; print "max:", (a > b ? a : b), sqrt(a^2 + b^2); print(a, b) }'`,
  "awk 'BEGIN {\n  # trung bình 3 phiên\n  s = 25.1; s += 25.3; s += 25.0\n  ma = s/3\n  printf \"%.10g\\n\", ma\n}'",
  `awk 'BEGIN{printf "%.0f\\n", (${Array.from({ length: 300 }, (_, i) => 12_000_000 + i).join("+")})/300}'`,
]

test("PowerShell: bare arithmetic, ; or a line break between statements, [math]:: functions, variables assigned first", () => {
  for (const c of PS_OK) expect(mathOnlyCommand(c, PS), c).toBe(true)
})

test("PowerShell: arrays, ranges, variables, other types, invocation and chaining are not arithmetic", () => {
  for (const c of [
    "1,2*3", // an array repeated
    "2*3,4*5",
    "(1,2)*1e9",
    "1..3",
    "1..999999999",
    "$x*2", // never assigned: PowerShell would compute with $null
    "$x = 5; $y*2",
    "$x += 1",
    "$x = $x + 1",
    // A variable is `$name` and nothing more.
    "$x = 5; $x.GetType()",
    "$x = 5; $x[0]",
    "$x = 5; $x::MaxValue",
    "$x = 5; $x(1)",
    "$env:PATH",
    "$env:X = 1",
    "$global:x = 1",
    "${x} = 1",
    "$(1+1)",
    "$x = $(Get-Date)",
    "@(1,2)",
    "$x = 'a'",
    '$x = "1"',
    "$x = 1 | Out-File f",
    "$x = 1 > f",
    // PowerShell's own variables: reading leaks state, writing changes the session.
    "$ErrorActionPreference = 1",
    "$PSDefaultParameterValues = 1",
    "$_",
    "$pid",
    "$true + 1",
    "$null = 1",
    "$x = 1; if ($x) { 2 }",
    "$x = 1; while (1) { $x }",
    "$f = { 1 }",
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
    `${"1+".repeat(4001)}1`, // over MATH_MAX_CHARS
    Array.from({ length: 61 }, () => "1").join(";"),
  ]) expect(mathOnlyCommand(c, PS), c).toBe(false)
  expect(mathOnlyCommand(`${"1+".repeat(300)}1`, PS)).toBe(true)
})

test("POSIX: awk BEGIN with assignments, print and printf; files, system, getline, loops, redirects and bare expressions are not", () => {
  for (const c of AWK_OK) expect(mathOnlyCommand(c, BASH), c).toBe(true)
  for (const c of [
    "1/2", // runs a file under bash
    "(1+2)", // a subshell
    "echo $((1+2))",
    "echo 1+2 | bc",
    // Writing a file or starting a program: `>` and `|` after print are redirects in awk.
    String.raw`awk 'BEGIN{print 1 > "/tmp/x"}'`,
    String.raw`awk 'BEGIN{print 1 >> "/tmp/x"}'`,
    String.raw`awk 'BEGIN{a = 1; b = 2; print a > b}'`,
    String.raw`awk 'BEGIN{print 1, 2 > 3}'`,
    String.raw`awk 'BEGIN{print(1, 2) > "f"}'`,
    String.raw`awk 'BEGIN{printf "%d\n", 1 > "f"}'`,
    String.raw`awk 'BEGIN{printf("%d\n", 1) > "f"}'`,
    String.raw`awk 'BEGIN{printf("%d\n", 1 > 2)}'`,
    String.raw`awk 'BEGIN{print 1 | "sh"}'`,
    String.raw`awk 'BEGIN{"id" | getline x; print x}'`,
    String.raw`awk 'BEGIN{x = system("id")}'`,
    String.raw`awk 'BEGIN{system("id")}'`,
    String.raw`awk 'BEGIN{getline; print 1}'`,
    String.raw`awk 'BEGIN{x = getline}'`,
    String.raw`awk 'BEGIN{close("f")}'`,
    // Nothing that can run forever or define code.
    String.raw`awk 'BEGIN{while (1) x = 1}'`,
    String.raw`awk 'BEGIN{for (;;) x = 1}'`,
    String.raw`awk 'BEGIN{for (i = 0; i < 3; i++) print i}'`,
    String.raw`awk 'BEGIN{ if (1) { print 1 } }'`,
    String.raw`awk 'function f(x) { return x } BEGIN{print f(1)}'`,
    String.raw`awk 'BEGIN{x = 1} END{print x}'`,
    // awk's own names, fields, arrays and strings are not operands.
    String.raw`awk 'BEGIN{print ENVIRON["HOME"]}'`,
    String.raw`awk 'BEGIN{print ENVIRON}'`,
    String.raw`awk 'BEGIN{RS = 1; print RS}'`,
    String.raw`awk 'BEGIN{print $0}'`,
    String.raw`awk 'BEGIN{a[1] = 2; print a[1]}'`,
    String.raw`awk 'BEGIN{x = "id"; print x}'`,
    String.raw`awk 'BEGIN{print "a" "b"}'`,
    String.raw`awk 'BEGIN{a = 1; b = 2; print a b}'`,
    String.raw`awk 'BEGIN{print length("abc")}'`,
    String.raw`awk 'BEGIN{print rand()}'`,
    String.raw`awk 'BEGIN{print abs(1)}'`,
    String.raw`awk 'BEGIN{print "\x41"}'`,
    // A variable is read only after it was assigned (a mistyped name is 0 in awk).
    String.raw`awk 'BEGIN{gia = 5; printf "%.2f\n", gai*2}'`,
    String.raw`awk 'BEGIN{x += 1; print x}'`,
    String.raw`awk 'BEGIN{x = x + 1; print x}'`,
    String.raw`awk 'BEGIN{x = y = 1; print x}'`,
    // Comparisons and ?: only inside brackets; an expression alone does nothing.
    String.raw`awk 'BEGIN{x = 1 ? 2 : 3; print x}'`,
    String.raw`awk 'BEGIN{1+1}'`,
    String.raw`awk 'BEGIN{print 2**3}'`,
    String.raw`awk 'BEGIN{x = 1; x++; print x}'`,
    String.raw`awk 'BEGIN{}'`,
    // Options, files, other programs.
    String.raw`awk -v x=1 'BEGIN{print x}'`,
    String.raw`awk -f calc.awk`,
    String.raw`awk 'BEGIN{print 1}' /etc/passwd`,
    String.raw`awk 'BEGIN{print 1}' 'BEGIN{print 2}'`,
    String.raw`awk 'BEGIN{print 1}';id`,
    "awk 'BEGIN{print 1}'\nid",
    String.raw`awk 'BEGIN{printf "%*d\n", 5, 1}'`,
    String.raw`awk 'BEGIN{printf "%c\n", 65}'`,
    String.raw`awk 'BEGIN{printf "%.2f\n"}'`,
    `awk 'BEGIN{${Array.from({ length: 61 }, (_, i) => `x${i} = 1`).join(";")}}'`,
    `awk 'BEGIN{print ${"1+".repeat(4001)}1}'`,
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
  expect(sh.description).toContain("awk 'BEGIN{ g = ")
  // The description shows the multi-step form: models copy the example they are given.
  expect(ps.description).toContain("$g = 128.4/112 - 1")
  expect(ps.description + sh.description).not.toContain("không biến")
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
  // … and `print` keeps a value's digits (awk's own default is six).
  expect(shellArgs({ kind: "bash", path: "bash" }, ` ${AWK_OK[0]} `).at(-1)).toBe(`LC_ALL=C awk -v OFMT=%.15g -v CONVFMT=%.15g ${AWK_OK[0]!.slice(4)}`)
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
  // `print` no longer cuts a value to six digits (8.33333e+11), and variables carry over lines.
  const printed = text(await tool.execute({ command: "awk 'BEGIN{\n  x = 2.5e12/3\n  print x, 1/3\n}'" }, ctx()))
  expect(printed).toContain("833333333333.333 0.333333333333333")
}, 30_000)

test("every accepted form really runs in this machine's shell and prints only numbers", async () => {
  const tool = shellTool(ws())
  const cases = win ? PS_OK : Bun.which("awk") ? AWK_OK : []
  // Each form in its own shell, as the tool runs it, four at a time: one after another took 10.5 s
  // (about 1 s per PowerShell start), the slowest test of the suite.
  const outs: string[] = []
  for (let i = 0; i < cases.length; i += 4) {
    outs.push(...(await Promise.all(cases.slice(i, i + 4).map(async (command) => text(await tool.execute({ command }, ctx()))))))
  }
  cases.forEach((command, i) => {
    expect(outs[i], command).toContain("mã thoát 0")
    expect(outs[i]!.split(/\r?\n/).slice(1).join(" ").trim(), command).toMatch(/^[\s\d.=;:a-z+-]+$/i)
  })
}, 60_000)

test("through runTool with a read-only, non-interactive gate: arithmetic runs, other commands are refused", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.setMode("read-only")
  const tool = shellTool(ws())
  const command = win ? "[math]::Round(31250/4520, 2)" : String.raw`awk 'BEGIN{printf "%.2f\n", 31250/4520}'`
  expect(text(await runTool(tool, { command }, ctx(), new RwLock(), gate))).toContain("6.91")
  await expect(runTool(tool, { command: win ? "Get-Date" : "date" }, ctx(), new RwLock(), gate)).rejects.toThrow()
}, 30_000)

test("arithmetic in a form the grammar does not take is a near miss; programs and real commands are not", () => {
  for (const c of ['python -c "print(1.2*3)"', "python3 -c 'print(round(2.5e12/4e8, 2))'", 'node -e "console.log(2**10)"', "1,2*3", "2^3", "echo $((1+2))", "echo 1.5*3 | bc -l", "expr 3 + 4"])
    expect(mathNearMiss(c, PS), c).toBe(true)
  for (const c of ["3/2", "(1+2)*4"]) expect(mathNearMiss(c, BASH), c).toBe(true)
  for (const c of ["git status", "python phan_tich.py", 'python -c "import os; print(1)"', 'python -c "print(__import__(1))"', "ls -la", "Get-Date", "date +%s", "1", "3/2", "Get-ChildItem | Measure-Object"])
    expect(mathNearMiss(c, PS), c).toBe(false)
  expect(mathNearMiss("1/2", PS)).toBe(false) // accepted as is on PowerShell
})

test("a near miss is a tool error with the accepted form, before any approval: never a denial that says stop", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.setMode("read-only")
  const tool = shellTool(ws())
  for (const command of ['python -c "print(1.2*3)"', win ? "1,2*3" : "echo $((1+2))"]) {
    const error = await runTool(tool, { command }, ctx(), new RwLock(), gate).then(
      () => "",
      (e: Error) => e.message,
    )
    expect(error, command).toContain("chưa đúng dạng chỉ-toán")
    expect(error, command).toContain(win ? "[math]::Round" : "awk 'BEGIN{")
    expect(error, command).not.toContain("Không chạy.")
    expect(error, command).not.toContain("DỪNG")
  }
}, 30_000)
