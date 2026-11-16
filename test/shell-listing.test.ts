import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readScope } from "../src/core/fs/path-safety"
import { realish, Workspace } from "../src/core/fs/workspace"
import { PermissionGate } from "../src/core/permission"
import { listingCommand } from "../src/core/tools/shell/read-only"
import { absolutePathOnly, runShell } from "../src/core/tools/shell/run"
import { LISTING_TIMEOUT_MS, shellTool } from "../src/core/tools/shell/shell"
import { RwLock, runTool } from "../src/core/tools/wrap"

/**
 * A shell command that only lists a folder of the workspace runs unasked in every mode
 * (read-only.ts). The lists below are the whole promise: anything not accepted here asks.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-listing-"))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
const outside = path.join(root, "outside")
for (const dir of [data, path.join(project, "src", "core"), path.join(project, "Bao cao (Q3)"), path.join(project, "dữ liệu"), outside]) mkdirSync(dir, { recursive: true })
writeFileSync(path.join(project, ".env"), "KEY=1")
writeFileSync(path.join(outside, "secret.txt"), "x")
// A link inside the workspace that leads out of it (a junction on Windows needs no admin right).
let linked = false
try {
  symlinkSync(outside, path.join(project, "lien-ket"), process.platform === "win32" ? "junction" : "dir")
  linked = true
} catch {}
afterAll(() => rmSync(root, { recursive: true, force: true }))

const win = process.platform === "win32"
const ws = () => new Workspace(project, { home, data })
const PS = { kind: "powershell" as const, path: "powershell" }
const BASH = { kind: "bash" as const, path: "bash" }
const env = (shell: { kind: "powershell" | "bash" }) => {
  const w = ws()
  // The same check the shell tool makes (shell.ts `readable`).
  // The bash table reads as on Linux or macOS: bash on Windows is refused (see the test below).
  return { shell, platform: shell.kind === "bash" ? ("linux" as const) : process.platform, resolve: (raw: string) => path.resolve(project, raw), readable: (abs: string) => (w.contains(abs) || w.inScratch(abs)) && readScope(abs, w.env(), realish) === undefined }
}

/** Runs unasked. */
const BASH_OK = ["pwd", "ls", "ls src", "ls -la", "ls -la src/core", 'ls -1 src "Bao cao (Q3)"', 'ls -l "Bao cao (Q3)"', "ls dữ-liệu-không-có", "ls ./src/../src", "ls -d src", ...(win ? [] : [`ls ${project}/src`])]
const PS_OK = [
  "pwd",
  "Get-Location",
  "gl",
  "ls",
  "dir",
  "gci src",
  "Get-ChildItem -Force",
  "Get-ChildItem -Path src -Name",
  "dir -Directory",
  "dir -File src\\core",
  'Get-ChildItem -LiteralPath "Bao cao (Q3)"',
  'dir "dữ liệu"',
  "DIR SRC",
  `dir ${path.join(project, "src")}`,
]

/** Asks as before (the reason in the comment). */
const BASH_ASK = [
  "ls ..", // outside the workspace
  "ls /",
  `ls ${outside}`,
  "ls ~", // the shell expands it
  "ls ~/Documents",
  "ls $HOME",
  "ls ${HOME}",
  "ls `pwd`",
  "ls $(pwd)",
  "ls *", // a glob
  "ls src/*.ts",
  "ls ?",
  "ls [a-z]",
  "ls {a,b}",
  "ls 'src'", // single quotes: no literal path promise across shells
  'ls "$HOME"',
  'ls "a"b',
  "ls -R", // recursion
  "ls --color=always",
  "ls -la --",
  "ls -- -la",
  "ls; id", // more than one command
  "ls && id",
  "ls | head",
  "ls > out.txt",
  "ls\nid",
  "LS", // another program on a POSIX shell
  "./ls",
  "/bin/ls /etc",
  "ls -la src src src src src src src src src", // more than 8 paths
  "pwd -P",
  "pwd x",
  "dir", // PowerShell's names are not ls here
  "git status", // not in this set: git runs programs its config names
  "cat src/a.ts",
  "ls //host/share",
  "ls ../outside",
]
const PS_ASK = [
  "dir ..",
  "dir C:\\",
  `dir ${outside}`,
  "dir $env:USERPROFILE",
  "dir $env:USERPROFILE\\Documents",
  "dir ~",
  "dir ~\\Documents",
  "dir %USERPROFILE%",
  "dir env:",
  "dir Env:\\",
  "dir HKLM:\\SOFTWARE",
  "dir Function:",
  "dir Microsoft.PowerShell.Core\\FileSystem::C:\\",
  "dir C:x",
  "dir src:stream",
  "dir \\\\host\\share",
  "dir //host/share",
  "dir \\\\?\\C:\\",
  "dir -Recurse",
  "dir -Recurse src",
  "dir -Depth 1",
  "dir -Filter *.ts",
  "dir -Include x",
  "dir -Exclude x",
  "dir -Attributes Hidden",
  "dir -FollowSymlink",
  "dir -Path",
  '"dir"',
  "dir *",
  "dir src\\*.ts",
  "dir [a]",
  "dir `$x",
  "dir $(Get-Location)",
  "dir @(1)",
  "dir 'src'",
  "dir; Remove-Item x",
  "dir | Remove-Item",
  "dir > out.txt",
  "dir & calc",
  "dir src,core",
  "Get-ChildItem -Path src -Path core",
  "Get-Location -Stack",
  "Set-Location ..",
  "Get-Content src\\a.ts",
  "dir src core", // the second word would be -Filter
  "dir ..\\outside",
  "ls -la", // PowerShell reads -la as a parameter name
]

test("bash: listings of the workspace run, anything else asks", () => {
  for (const c of BASH_OK) expect([c, listingCommand(c, env(BASH))]).toEqual([c, true])
  for (const c of BASH_ASK) expect([c, listingCommand(c, env(BASH))]).toEqual([c, false])
})

test("PowerShell: listings of the workspace run, anything else asks", () => {
  for (const c of PS_OK) expect([c, listingCommand(c, env(PS))]).toEqual([c, true])
  for (const c of PS_ASK) expect([c, listingCommand(c, env(PS))]).toEqual([c, false])
})

test("the shell tool: read: in the workspace, after outside: and protected:; key files and links that leave the workspace ask", () => {
  // bash on Windows is refused (read-only.ts), so on Windows only PowerShell is the shell under test.
  if (win) expect(shellTool(ws(), { shell: BASH }).askFor!({ command: "ls src" })).not.toStartWith("read:")
  for (const shell of win ? [PS] : [PS, BASH]) {
    const tool = shellTool(ws(), { shell })
    expect(tool.askFor!({ command: "ls src" })).toBe("read:ls src")
    expect(tool.askFor!({ command: "pwd" })).toBe("read:pwd")
    // Another folder to run in: outside the workspace wins.
    expect(tool.askFor!({ command: "ls", workdir: outside })).toBe(`outside:${outside}`)
    // A key file or folder by name: protected wins.
    expect(tool.askFor!({ command: "ls .env" })).toStartWith("protected:")
    expect(tool.askFor!({ command: "ls .opentrading" })).toStartWith("protected:")
    expect(tool.askFor!({ command: "ls .ssh" })).toStartWith("protected:")
    expect(tool.askFor!({ command: "dir .ssh" })).toStartWith("protected:")
    // A link in the workspace that leads out of it: read_file would ask too.
    if (linked) expect(tool.askFor!({ command: "ls lien-ket" })).not.toStartWith("read:")
    expect(tool.askFor!({ command: "ls .." })).not.toStartWith("read:")
  }
})

test("the gate runs a listing in every mode with nobody to ask; deny and ask rules still apply; ▸▸ spends no classifier request", async () => {
  const tool = shellTool(ws(), { shell: win ? PS : BASH })
  const signal = new AbortController().signal
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  for (const mode of ["read-only", "ask"] as const) {
    gate.setMode(mode)
    expect(await gate.check(tool, { command: "ls src" }, signal)).toEqual({ allow: true })
    expect((await gate.check(tool, { command: "ls .." }, signal)).allow).toBe(false)
  }
  let reviews = 0
  ;(gate as unknown as { auto: unknown }).auto = {
    log: { action() {}, denied() {}, approved() {} },
    ranWithoutBlock() {},
    review: async () => {
      reviews++
      return { decision: "allow" }
    },
  }
  gate.setMode("auto")
  expect(await gate.check(tool, { command: "ls src" }, signal)).toEqual({ allow: true })
  expect(reviews).toBe(0)
  const ruled = new PermissionGate({
    load: async () => [],
    save: async () => {},
    lists: async () => ({ deny: [{ tool: "shell", pattern: "ls src*" }], ask: [{ tool: "shell", pattern: "pwd*" }] }),
  })
  await ruled.refreshRules()
  ruled.setMode("ask")
  expect(await ruled.check(tool, { command: "ls src" }, signal)).toMatchObject({ allow: false, reason: "rule" })
  expect(await ruled.check(tool, { command: "pwd" }, signal)).toMatchObject({ allow: false, reason: "headless" })
  expect(await ruled.check(tool, { command: "ls" }, signal)).toEqual({ allow: true })
})

test("a listing really runs through runTool in ‖ with nobody to ask, under the short time limit", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.setMode("read-only")
  const tool = shellTool(ws())
  const out = await runTool(tool, { command: win ? "dir -Name" : "ls" }, { signal: new AbortController().signal, callId: "l" }, new RwLock(), gate)
  const text = typeof out === "string" ? out : out.output
  expect(text).toContain("exit code 0")
  expect(text).toContain("src")
  expect(LISTING_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
}, 30_000)

test("every accepted form really runs in this machine's shell and exits 0", async () => {
  const tool = shellTool(ws())
  const cases = (win ? PS_OK : BASH_OK).filter((c) => !c.includes("không-có"))
  const outs = await Promise.all(cases.map(async (command) => {
    const r = await tool.execute({ command }, { signal: new AbortController().signal, callId: "x" })
    return typeof r === "string" ? r : r.output
  }))
  cases.forEach((command, i) => {
    expect([command, outs[i]!.split("\n")[0]!.includes("exit code 0")]).toEqual([command, true])
    expect(outs[i], command).not.toContain("LỖI:")
  })
}, 60_000)

test("pwsh on Linux and macOS: a backslash is a separator there too, and there is no drive", () => {
  const linux = { ...env(PS), platform: "linux" as const, resolve: (raw: string) => path.posix.resolve("/w/project", raw), readable: (abs: string) => abs === "/w/project" || abs.startsWith("/w/project/") }
  expect(listingCommand(String.raw`dir src\core`, linux)).toBe(true)
  for (const c of [String.raw`dir ..\outside`, String.raw`dir ..\..\etc`, String.raw`dir C:\x`, "dir C:/x"]) expect([c, listingCommand(c, linux)]).toEqual([c, false])
})

test("a tilde runs only inside an 8.3 short name; at a word start or after = or : it is home", () => {
  const w = env(PS)
  const short = { ...w, readable: () => true }
  for (const c of ["dir RUNNER~1", "dir src/PROGRA~2/x", 'dir "src/RUNNER~1/AppData"']) expect([c, listingCommand(c, short)]).toEqual([c, true])
  for (const c of ["dir ~", "dir ~/x", "dir ~1", "dir a~", "dir a~b", "dir a=~/x", "dir a:~/x", "dir src/~x", 'dir "~"', 'dir "a/~/b"']) expect([c, listingCommand(c, short)]).toEqual([c, false])
  for (const c of ["ls ~", "ls a=~/x", "ls x:~/y"]) expect([c, listingCommand(c, { ...env(BASH), readable: () => true })]).toEqual([c, false])
})

test("bash: a backslash is an escape, never part of a plain path", () => {
  for (const c of [String.raw`ls src\core`, String.raw`ls "src\core"`, String.raw`ls \..`]) expect([c, listingCommand(c, env(BASH))]).toEqual([c, false])
})

/** What a listing of the workspace must never show: the folder next to it, its file, the home folder's data. */
const leaks = (out: string) => out.split(/\r?\n/).filter((line) => /secret\.txt|\.opentrading|(^|[\s\\/])home([\s\\/]|$)/.test(line) || (/(^|\s)outside(\s|$)/.test(line) && !line.includes("->")))

test("what an accepted listing prints never reaches outside the workspace, odd Windows spellings included", async () => {
  const tool = shellTool(ws())
  // A link's target is shown by ls -l (`lien-ket -> …/outside`): a name, never what is behind it.
  const candidates = win
    ? [...PS_OK, 'dir ".. "', 'dir ". ."', 'dir "..."', 'dir "src\\.. \\.."', 'dir "src\\..\\.."', 'dir ". "', "dir ...", "dir ....", 'Get-ChildItem -LiteralPath ".. "', "dir lien-ket", "dir -Force lien-ket"]
    : [...BASH_OK, "ls ...", "ls -la lien-ket", "ls lien-ket/"]
  const accepted = candidates.filter((command) => tool.askFor!({ command })?.startsWith("read:"))
  // The plain forms are all accepted; of the odd ones, whatever is accepted must stay inside.
  for (const c of win ? PS_OK : BASH_OK) expect(accepted).toContain(c)
  const outs = await Promise.all(
    accepted.map(async (command) => {
      const r = await tool.execute({ command }, { signal: new AbortController().signal, callId: "x" })
      return typeof r === "string" ? r : r.output
    }),
  )
  accepted.forEach((command, i) => expect([command, leaks(outs[i]!.split("\n").slice(1).join("\n"))]).toEqual([command, []]))
}, 60_000)

test("a network or device path is refused on the string alone: nothing resolves it", () => {
  const touched: string[] = []
  const trap = {
    shell: PS,
    resolve: (raw: string) => {
      touched.push(raw)
      throw new Error("resolved")
    },
    readable: (abs: string) => {
      touched.push(abs)
      throw new Error("read")
    },
  }
  const bs = String.fromCharCode(92)
  const unc = `${bs}${bs}host${bs}share`
  for (const c of [`dir ${unc}`, "dir //host/share", `dir ${bs}${bs}.${bs}pipe${bs}x`, `dir ${bs}${bs}?${bs}C:${bs}`, `Get-ChildItem -Path ${unc}`, `dir "${unc}"`]) expect([c, listingCommand(c, trap)]).toEqual([c, false])
  for (const c of ["ls //host/share", `ls "//host/x"`]) expect([c, listingCommand(c, { ...trap, shell: BASH })]).toEqual([c, false])
  expect(touched).toEqual([])
  // Through the tool, also when the folder exists nowhere: no resolution before the refusal.
  const tool = shellTool(ws(), { shell: PS })
  expect(tool.askFor!({ command: `dir ${unc}` })).not.toStartWith("read:")
})

test("a path part ending in a dot or a space is refused: Windows would drop it", () => {
  for (const c of ['dir "src\\.. \\.."', 'dir ".. "', 'dir "..."', "dir ...", 'dir "src. "', "dir src.", 'Get-ChildItem -LiteralPath "src \\.."'])
    expect([c, listingCommand(c, env(PS))]).toEqual([c, false])
  for (const c of ['ls "src. "', "ls src.", "ls ..."]) expect([c, listingCommand(c, env(BASH))]).toEqual([c, false])
  expect(listingCommand("dir src\\..", env(PS))).toBe(true)
})

test("characters PowerShell reads as a dash, a quote or a space are refused", () => {
  const ch = (code: number) => String.fromCharCode(code)
  for (const c of [`dir ${ch(0x2013)}Recurse`, `dir ${ch(0x2014)}Recurse`, `dir ${ch(0x201c)}src${ch(0x201d)}`, `dir ${ch(0x2018)}src${ch(0x2019)}`, `dir${ch(0xa0)}src`, `dir src${ch(0x3000)}x`, `dir ${ch(0xff0d)}Recurse`])
    expect([c, listingCommand(c, env(PS))]).toEqual([c, false])
})

test("bash or sh on Windows (Git Bash, MSYS) is refused: it maps /d/x and /tmp unlike the path check", () => {
  for (const kind of ["bash", "sh"] as const) {
    const onWindows = { shell: { kind }, platform: "win32" as const, resolve: (raw: string) => raw, readable: () => true }
    for (const c of ["pwd", "ls", "ls src", "ls /d/x"]) expect([kind, c, listingCommand(c, onWindows)]).toEqual([kind, c, false])
  }
})

test("a relative or empty PATH entry never makes a bare ls run a file of the workspace", async () => {
  expect(absolutePathOnly(":/usr/bin:.:bin:/bin:")).toBe("/usr/bin:/bin")
  if (process.platform === "win32") return
  const dir = mkdtempSync(path.join(os.tmpdir(), "ot-path-"))
  const saved = process.env.PATH
  try {
    writeFileSync(path.join(dir, "ls"), "#!/bin/sh\necho PLANTED\n", { mode: 0o755 })
    process.env.PATH = `.:${saved}`
    const out = await runShell("ls", { cwd: dir, timeoutMs: 10_000, signal: new AbortController().signal })
    expect(out.output).not.toContain("PLANTED")
  } finally {
    process.env.PATH = saved
    rmSync(dir, { recursive: true, force: true })
  }
})
