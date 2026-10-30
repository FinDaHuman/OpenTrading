import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { FileState } from "../src/core/fs/file-state"
import { FileHistory } from "../src/core/fs/history"
import { writeCheck } from "../src/core/fs/path-safety"
import { Scratchpad, scratchBase, scratchFolderName } from "../src/core/fs/scratch"
import { realish, Workspace } from "../src/core/fs/workspace"
import { PermissionGate, type RuleStore } from "../src/core/permission"
import { shellTool } from "../src/core/tools/shell/shell"
import { writeFileTool } from "../src/core/tools/fs/write"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-scratch-"))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
const tmp = path.join(root, "tmp")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
mkdirSync(tmp, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ctx = () => ({ signal: new AbortController().signal, callId: "c" })
const tick = () => new Promise((r) => setTimeout(r, 5))

function setup(sessionId = "20261031-090000-abcd") {
  const workspace = new Workspace(project, { home, data })
  workspace.scratch = new Scratchpad(project, { tmp })
  workspace.scratch.attach(sessionId)
  const deps = { workspace, state: new FileState(), history: new FileHistory(path.join(data, "file-history")) }
  return { workspace, scratch: workspace.scratch, write: writeFileTool(deps), shell: shellTool(workspace) }
}

const store = (rules: { deny?: { tool: string; pattern?: string }[]; ask?: { tool: string; pattern?: string }[] } = {}): RuleStore => ({
  load: async () => [],
  save: async () => {},
  lists: async () => ({ deny: rules.deny ?? [], ask: rules.ask ?? [] }),
})

/** Run through the gate the way the agent loop does, answering the first prompt with `choice`. */
async function viaGate(gate: PermissionGate, def: ToolDef, input: unknown, choice?: Parameters<PermissionGate["respond"]>[1]) {
  let settled = false
  const run = runTool(def, input, ctx(), new RwLock(), gate).then(
    (r) => ({ ok: true as const, output: r.output }),
    (e: Error) => ({ ok: false as const, output: e.message }),
  )
  void run.then(() => (settled = true))
  for (let i = 0; i < 400 && !settled && !gate.head(); i++) await tick()
  const asked = gate.head()
  if (asked && choice) await gate.respond(asked.id, choice)
  return { asked, result: await run }
}

// ── where the folder is ─────────────────────────────────────────────────────

test("folder name: the cwd with every non-alphanumeric as '-', cut to 60 characters plus a hash", () => {
  expect(scratchFolderName("D:\\Dau-tu\\Phan tich")).toBe("D--Dau-tu-Phan-tich")
  const long = scratchFolderName(`D:\\${"a".repeat(100)}`)
  expect(long).toMatch(/^D--a{57}-[0-9a-f]{8}$/)
  expect(scratchFolderName(`D:\\${"a".repeat(100)}`)).toBe(long)
  expect(scratchFolderName(`D:\\${"a".repeat(101)}`)).not.toBe(long)
})

test("base: <tmp>/opentrading on Windows, <tmp>/opentrading-<uid> on POSIX", () => {
  expect(scratchBase("C:\\Temp", "win32")).toBe(path.join("C:\\Temp", "opentrading"))
  if (process.platform !== "win32") expect(scratchBase("/tmp", "linux")).toBe(path.join("/tmp", `opentrading-${process.getuid!()}`))
})

test("session folder: <project>/<session id>/scratchpad, follows /new, off when disabled or before a session", async () => {
  const pad = new Scratchpad(project, { tmp })
  expect(pad.dir()).toBeUndefined()
  pad.attach("s1")
  expect(pad.project).toBe(path.join(realish(scratchBase(tmp)), scratchFolderName(project)))
  expect(pad.dir()).toBe(path.join(pad.project, "s1", "scratchpad"))
  pad.attach("s2")
  expect(pad.dir()).toBe(path.join(pad.project, "s2", "scratchpad"))
  expect(pad.contains(path.join(pad.project, "s1", "scratchpad", "a.py"))).toBe(true)
  expect(pad.contains(path.join(pad.project, "..", "khac", "a.py"))).toBe(false)
  pad.enabled = false
  expect(pad.dir()).toBeUndefined()
  expect(pad.contains(path.join(pad.project, "s2", "scratchpad", "a.py"))).toBe(false)
  expect(await pad.ensure()).toBeUndefined()
})

test.skipIf(process.platform === "win32")("POSIX: a base folder planted as a symlink turns the scratchpad off", async () => {
  const planted = path.join(root, "planted")
  const other = path.join(root, "tmp-link")
  mkdirSync(planted, { recursive: true })
  mkdirSync(other, { recursive: true })
  symlinkSync(planted, scratchBase(other), "dir")
  const pad = new Scratchpad(project, { tmp: other })
  pad.attach("s")
  expect(await pad.ensure()).toBeUndefined()
  expect(pad.dir()).toBeUndefined()
  expect(pad.contains(path.join(planted, "x"))).toBe(false)
})

test("ensure creates the folder lazily and again after the OS emptied the temp dir", async () => {
  const { scratch } = setup("lazy")
  const dir = scratch.dir()!
  expect(existsSync(dir)).toBe(false)
  expect(await scratch.ensure()).toBe(dir)
  expect(existsSync(dir)).toBe(true)
  rmSync(scratch.project, { recursive: true, force: true })
  expect(await scratch.ensure()).toBe(dir)
  expect(existsSync(dir)).toBe(true)
})

test("the <quyen_tep> reminder names this session's folder; none when off", () => {
  const { workspace, scratch } = setup("nhac")
  expect(workspace.describe()).toContain(`Thư mục tạm của phiên: ${scratch.dir()}`)
  scratch.enabled = false
  expect(workspace.describe()).not.toContain("Thư mục tạm")
  expect(new Workspace(project, { home, data }).describe()).not.toContain("Thư mục tạm")
})

// ── permission ──────────────────────────────────────────────────────────────

test("writeCheck: scratch: inside the folder (even under .git), key files and escapes still ask", () => {
  const { workspace, scratch } = setup()
  const dir = scratch.dir()!
  const check = (p: string) => writeCheck(p, (x) => workspace.contains(x), workspace.env(), realish, (x) => workspace.inScratch(x))
  expect(check(path.join(dir, "tinh.py"))).toEqual({ scope: `scratch:${dir}` })
  expect(check(path.join(dir, "repo", ".git", "config"))).toEqual({ scope: `scratch:${path.join(dir, "repo", ".git")}` })
  expect(check(path.join(dir, ".env"))).toEqual({ scope: `protected:${path.join(dir, ".env")}` })
  expect(check(path.join(scratch.project, "..", "khac.md"))).toEqual({ scope: `outside:${path.join(scratch.project, "..", "khac.md")}` })
  expect(check(path.join(project, "bao-cao.md"))).toEqual({ scope: `edit:${project}` })
})

test("a link inside the folder that points out of it is not the folder (junction to home)", async () => {
  const { workspace, scratch } = setup("link")
  const dir = (await scratch.ensure())!
  const link = path.join(dir, "ra-ngoai")
  symlinkSync(home, link, process.platform === "win32" ? "junction" : "dir")
  const target = path.join(link, ".bashrc")
  expect(workspace.inScratch(target)).toBe(false)
  const check = writeCheck(target, (x) => workspace.contains(x), workspace.env(), realish, (x) => workspace.inScratch(x))
  expect(check).toEqual({ scope: `protected:${target}` })
})

test("▸ ask: a write in the folder runs without a prompt; ‖ read-only still asks; deny and ask rules win", async () => {
  const s = setup("gate")
  const file = path.join(s.scratch.dir()!, "ket-qua.csv")
  const gate = new PermissionGate(store())
  gate.interactive = true
  gate.setMode("ask")
  const free = await viaGate(gate, s.write, { path: file, content: "ma,gia\n" })
  expect(free.asked).toBeUndefined()
  expect(free.result.ok).toBe(true)
  expect(readFileSync(file, "utf8")).toBe("ma,gia\n")

  gate.setMode("read-only")
  const ro = await viaGate(gate, s.write, { path: path.join(s.scratch.dir()!, "b.csv"), content: "x" }, "deny")
  expect(ro.asked?.choices).toEqual(["once", "mode", "deny"])
  expect(ro.result.ok).toBe(false)

  const denyGate = new PermissionGate(store({ deny: [{ tool: "write_file" }] }))
  denyGate.interactive = true
  denyGate.setMode("ask")
  const denied = await viaGate(denyGate, s.write, { path: path.join(s.scratch.dir()!, "c.csv"), content: "x" })
  expect(denied.asked).toBeUndefined()
  expect(denied.result.ok).toBe(false)

  const askGate = new PermissionGate(store({ ask: [{ tool: "write_file" }] }))
  askGate.interactive = true
  askGate.setMode("ask")
  const asked = await viaGate(askGate, s.write, { path: path.join(s.scratch.dir()!, "d.csv"), content: "x" }, "deny")
  expect(asked.asked?.scope).toStartWith("scratch:")
})

test("▸▸ auto: a write in the folder never reaches the classifier", async () => {
  const s = setup("auto")
  const gate = new PermissionGate(store())
  gate.interactive = true
  let reviews = 0
  gate.auto = {
    log: { action() {}, denied() {} },
    ranWithoutBlock() {},
    review: async () => {
      reviews++
      return { decision: "allow" }
    },
  } as unknown as PermissionGate["auto"]
  gate.setMode("auto")
  const run = await viaGate(gate, s.write, { path: path.join(s.scratch.dir()!, "e.py"), content: "print(1)\n" })
  expect(run.asked).toBeUndefined()
  expect(run.result.ok).toBe(true)
  expect(reviews).toBe(0)
})

test("shell: the folder is a fine working directory, the command itself still asks", () => {
  const { shell, scratch } = setup("shell")
  expect(shell.askFor?.({ command: "python tinh.py", workdir: scratch.dir() })).toBe("cmd!python tinh.py")
  expect(shell.askFor?.({ command: "git status", workdir: scratch.dir() })).toBe("cmd:git status")
  expect(shell.askFor?.({ command: "git status", workdir: tmp })).toBe(`outside:${tmp}`)
  scratch.enabled = false
  expect(shell.askFor?.({ command: "git status", workdir: scratch.dir() ?? path.join(scratch.project, "x") })).toStartWith("outside:")
})
