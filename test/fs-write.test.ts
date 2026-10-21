import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { lineDiff, newFileDiff } from "../src/core/fs/diff"
import { FileState } from "../src/core/fs/file-state"
import { FileHistory, pruneHistory } from "../src/core/fs/history"
import { protectedWriteReason, writeCheck } from "../src/core/fs/path-safety"
import { decodeFile, encodeFile } from "../src/core/fs/text"
import { Workspace } from "../src/core/fs/workspace"
import { choicesFor, PermissionGate, type RuleStore } from "../src/core/permission"
import { readFileTool } from "../src/core/tools/fs/read"
import { applyEdit, editFileTool, writeFileTool } from "../src/core/tools/fs/write"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-write-"))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const env = { home, data }
const w32 = String.raw
const ctx = () => ({ signal: new AbortController().signal, callId: "c" })
const tick = () => new Promise((r) => setTimeout(r, 5))

function setup() {
  const workspace = new Workspace(project, env)
  const state = new FileState()
  const history = new FileHistory(path.join(data, "file-history"))
  const deps = { workspace, state, history }
  return { ...deps, read: readFileTool(workspace, state), write: writeFileTool(deps), edit: editFileTool(deps) }
}

const memoryStore = (rules: { deny?: { tool: string; pattern?: string }[]; ask?: { tool: string; pattern?: string }[] } = {}): RuleStore & { saved: number } => {
  const store = {
    saved: 0,
    load: async () => [],
    save: async () => void store.saved++,
    lists: async () => ({ deny: rules.deny ?? [], ask: rules.ask ?? [] }),
  }
  return store
}

/** Run through the gate the way the agent loop does, answering the first prompt with `choice`. */
async function viaGate(gate: PermissionGate, def: ToolDef, input: unknown, choice?: Parameters<PermissionGate["respond"]>[1]) {
  let settled = false
  const run = runTool(def, input, ctx(), new RwLock(), gate).then(
    (r) => ({ ok: true as const, output: r.output }),
    (e: Error) => ({ ok: false as const, output: e.message }),
  )
  void run.then(() => (settled = true))
  // The prompt shows once validate/preview have read the file: wait for it or for the end.
  for (let i = 0; i < 400 && !settled && !gate.head(); i++) await tick()
  const asked = gate.head()
  if (asked && choice) await gate.respond(asked.id, choice)
  return { asked, result: await run }
}

// ── where a write may go ────────────────────────────────────────────────────

test("protected writes: OpenTrading data and config, tool folders, rc files, autostart, key files", () => {
  expect(protectedWriteReason(path.join(data, "config.json"), env)).toContain("OpenTrading")
  expect(protectedWriteReason(path.join(data, "workspace", "ke-hoach.md"), env)).toBeUndefined()
  expect(protectedWriteReason(path.join(project, ".opentrading", "skills", "x", "SKILL.md"), env)).toContain(".opentrading")
  expect(protectedWriteReason(path.join(project, ".git", "hooks", "pre-commit"), env)).toContain(".git")
  expect(protectedWriteReason(path.join(project, ".mcp.json"), env)).toBeDefined()
  expect(protectedWriteReason(path.join(home, ".bashrc"), env)).toBeDefined()
  expect(protectedWriteReason(path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"), env)).toBeDefined()
  expect(protectedWriteReason(path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "x.bat"), env)).toContain("đăng nhập")
  expect(protectedWriteReason(path.join(project, ".env"), env)).toBeDefined()
  expect(protectedWriteReason(path.join(project, "bao-cao", "fpt.md"), env)).toBeUndefined()
})

test("writeCheck: block odd Windows paths and UNC, protected and outside ask, the workspace is per folder", () => {
  const win = { home: w32`C:\Users\ban`, data: w32`C:\Users\ban\.opentrading`, platform: "win32" as const }
  const inside = (p: string) => p.toLowerCase().startsWith(w32`d:\dau-tu`)
  expect(writeCheck(w32`D:\Dau-tu\a.md:hidden`, inside, win)).toHaveProperty("block")
  expect(writeCheck(w32`\\srv\share\a.md`, inside, win)).toHaveProperty("block")
  expect(writeCheck(w32`D:\Dau-tu\PROGRA~1\a.md`, inside, win)).toHaveProperty("block")
  expect(writeCheck(w32`C:\Users\ban\.opentrading\config.json`, inside, win)).toEqual({ scope: w32`protected:C:\Users\ban\.opentrading\config.json` })
  expect(writeCheck(w32`E:\khac\a.md`, inside, win)).toEqual({ scope: w32`outside:E:\khac\a.md` })
  expect(writeCheck(w32`D:\Dau-tu\bao-cao\a.md`, inside, win)).toEqual({ scope: w32`edit:D:\Dau-tu\bao-cao` })
})

// ── diff, history ───────────────────────────────────────────────────────────

test("lineDiff keeps two lines of context and collapses the rest", () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n")
  const after = before.replace("l10", "L10 mới")
  const d = lineDiff(before, after)
  expect(d.added).toBe(1)
  expect(d.removed).toBe(1)
  expect(d.lines.map((l) => `${l.kind}${l.text}`)).toEqual(["…", " l8", " l9", "-l10", "+L10 mới", " l11", " l12", "…"])
  expect(newFileDiff("a\nb\n").added).toBe(2)
  expect(lineDiff("x", "x").lines).toEqual([])
})

test("history: a created file undoes by deletion, a changed one by restore; a later change needs --force", async () => {
  const history = new FileHistory(path.join(root, "hist"))
  const fresh = path.join(project, "h-new.md")
  writeFileSync(fresh, "mới")
  await (await history.before(fresh, undefined)).commit(new TextEncoder().encode("mới"), "write_file")
  expect(history.createdThisRun(fresh)).toBe(true)
  const old = path.join(project, "h-old.md")
  writeFileSync(old, "v2")
  await (await history.before(old, new TextEncoder().encode("v1"))).commit(new TextEncoder().encode("v2"), "edit_file")
  expect(history.list().map((c) => c.n)).toEqual([2, 1])
  writeFileSync(old, "v3 by the user")
  expect(await history.undo(2)).toHaveProperty("error")
  expect(await history.undo(2, true)).toHaveProperty("ok")
  expect(readFileSync(old, "utf8")).toBe("v1")
  expect(await history.undo(2)).toHaveProperty("error") // already undone
  expect(await history.undo(1)).toHaveProperty("ok")
  expect(existsSync(fresh)).toBe(false)
  expect(readFileSync(path.join(history.dir, "index.jsonl"), "utf8").trim().split("\n")).toHaveLength(2)
  await pruneHistory(path.join(root, "hist"), 30, Date.now() + 31 * 86_400_000)
  expect(existsSync(history.dir)).toBe(false)
})

// ── write_file / edit_file ─────────────────────────────────────────────────

test("write_file creates a new file (parents too) and refuses to overwrite one it has not read in full", async () => {
  const s = setup()
  const out = await s.write.execute({ path: "bao-cao/ke-hoach-FPT.md", content: "# Kế hoạch\n- Theo dõi FPT\n" }, ctx())
  const file = path.join(project, "bao-cao", "ke-hoach-FPT.md")
  expect(out).toContain(`Đã tạo ${file}`)
  expect(readFileSync(file, "utf8")).toBe("# Kế hoạch\n- Theo dõi FPT\n")
  expect(s.history.createdThisRun(file)).toBe(true)
  // Written by the tool: it counts as read, so it can be rewritten at once.
  expect(await s.write.execute({ path: file, content: "# v2\n" }, ctx())).toContain("Đã ghi đè")

  const notes = path.join(project, "ghi-chu.md")
  writeFileSync(notes, Array.from({ length: 10 }, (_, i) => `dòng ${i}`).join("\n"))
  const fresh = setup()
  expect(await fresh.write.validate!({ path: notes, content: "x" })).toContain("Chưa đọc")
  await fresh.read.execute({ path: notes, offset: 3 }, ctx())
  expect(await fresh.write.validate!({ path: notes, content: "x" })).toContain("một phần")
  await fresh.read.execute({ path: notes }, ctx())
  expect(await fresh.write.validate!({ path: notes, content: "x" })).toBeUndefined()
  writeFileSync(notes, "người dùng vừa sửa")
  expect(await fresh.write.validate!({ path: notes, content: "x" })).toContain("đã thay đổi")
  await expect(fresh.write.execute({ path: notes, content: "x" }, ctx())).rejects.toThrow("đã thay đổi")
})

test("pages read in order up to EOF count as a full read; a gap or a changed file does not", async () => {
  const file = path.join(project, "trang.md")
  writeFileSync(file, Array.from({ length: 180 }, (_, i) => `dòng ${i + 1}`).join("\n"))
  const s = setup()
  // Four pages, following the footer's offset like the model does.
  let offset = 1
  for (let page = 0; page < 4; page++) {
    const out = (await s.read.execute({ path: file, offset, limit: 50 }, ctx())) as string
    const next = /offset=(\d+)/.exec(out)?.[1]
    if (page < 3) expect(await s.write.validate!({ path: file, content: "x" })).toContain("một phần")
    if (!next) break
    offset = Number(next)
  }
  expect(await s.write.validate!({ path: file, content: "x" })).toBeUndefined()

  // A gap (lines 51–100 never shown) keeps the file partial.
  const gap = setup()
  await gap.read.execute({ path: file, offset: 1, limit: 50 }, ctx())
  await gap.read.execute({ path: file, offset: 101, limit: 100 }, ctx())
  expect(await gap.write.validate!({ path: file, content: "x" })).toContain("một phần")

  // Pages of different bytes do not add up.
  const changed = setup()
  await changed.read.execute({ path: file, offset: 1, limit: 100 }, ctx())
  writeFileSync(file, Array.from({ length: 180 }, (_, i) => `DÒNG ${i + 1}`).join("\n"))
  await changed.read.execute({ path: file, offset: 101, limit: 100 }, ctx())
  expect(await changed.write.validate!({ path: file, content: "x" })).toContain("một phần")
})

test("a line cut at 2000 characters keeps the file partial: write_file cannot overwrite the unseen tail", async () => {
  const file = path.join(project, "mot-dong.json")
  const json = JSON.stringify({ data: "x".repeat(12_000), tail: "PHẦN-ĐUÔI" })
  writeFileSync(file, json)
  const s = setup()
  const out = (await s.read.execute({ path: file }, ctx())) as string
  expect(out).toContain("dòng bị cắt")
  expect(out).not.toContain("PHẦN-ĐUÔI")
  expect(await s.write.validate!({ path: file, content: "{}" })).toContain("một phần")
  await expect(s.write.execute({ path: file, content: "{}" }, ctx())).rejects.toThrow("một phần")
  expect(readFileSync(file, "utf8")).toBe(json)
})

test("write_file keeps an existing file's CRLF and UTF-16 encoding", async () => {
  const s = setup()
  const file = path.join(project, "ps.txt")
  writeFileSync(file, encodeFile("a\r\nb\r\n", "utf16le"))
  await s.read.execute({ path: file }, ctx())
  await s.write.execute({ path: file, content: "Mã\nGiá\n" }, ctx())
  const back = decodeFile(new Uint8Array(readFileSync(file)))
  expect(back.encoding).toBe("utf16le")
  expect(back.text).toBe("Mã\r\nGiá\r\n")
})

test("applyEdit: unique match, replace_all, not found, same text, curly quotes from Word", () => {
  expect(applyEdit("a b a", "b", "c")).toEqual({ text: "a c a", count: 1 })
  expect(applyEdit("a b a", "a", "x")).toHaveProperty("error")
  expect((applyEdit("a b a", "a", "x") as { error: string }).error).toContain("2 lần")
  expect(applyEdit("a b a", "a", "x", true)).toEqual({ text: "x b x", count: 2 })
  expect((applyEdit("abc", "zzz", "y") as { error: string }).error).toContain("Không tìm thấy")
  expect(applyEdit("abc", "b", "b")).toHaveProperty("error")
  expect(applyEdit("abc", "", "y")).toHaveProperty("error")
  // The file says “mục tiêu”, the model typed "mục tiêu".
  expect(applyEdit("Ghi “mục tiêu” ở đây", '"mục tiêu"', '"mục tiêu mới"')).toEqual({ text: "Ghi “mục tiêu mới” ở đây", count: 1 })
  // $& in the new text is literal, not a regex back-reference.
  expect(applyEdit("giá X", "X", "$&100")).toEqual({ text: "giá $&100", count: 1 })
})

test("edit_file needs a read, keeps CRLF, and reports a bad edit before anyone is asked", async () => {
  const s = setup()
  const file = path.join(project, "bang.csv")
  writeFileSync(file, "ma,gia\r\nFPT,120\r\nVCB,90\r\n")
  expect(await s.edit.validate!({ path: file, old_string: "FPT,120", new_string: "FPT,125" })).toContain("Chưa đọc")
  await s.read.execute({ path: file }, ctx())
  expect(await s.edit.validate!({ path: file, old_string: "HPG", new_string: "x" })).toContain("Không tìm thấy")
  const preview = await s.edit.preview!({ path: file, old_string: "FPT,120", new_string: "FPT,125" })
  expect(preview?.title).toContain("+1 −1")
  expect(preview?.diff?.filter((l) => l.kind !== " ").map((l) => `${l.kind}${l.text}`)).toEqual(["-FPT,120", "+FPT,125"])
  expect(await s.edit.execute({ path: file, old_string: "FPT,120", new_string: "FPT,125" }, ctx())).toContain("Đã sửa")
  expect(readFileSync(file, "utf8")).toBe("ma,gia\r\nFPT,125\r\nVCB,90\r\n")
  // A rejected edit never reaches the gate: no prompt, the model reads the error.
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  const { asked, result } = await viaGate(gate, s.edit, { path: file, old_string: "không có", new_string: "x" })
  expect(asked).toBeUndefined()
  expect(result.output).toContain("Không tìm thấy")
})

// ── the gate pipeline ───────────────────────────────────────────────────────

test("read-only mode asks every write with 'switch to ▸'; choosing it switches the mode", async () => {
  const s = setup()
  const gate = new PermissionGate(memoryStore())
  gate.interactive = true
  expect(gate.mode).toBe("read-only")
  const first = await viaGate(gate, s.write, { path: "ro-1.md", content: "x\n" }, "mode")
  expect(first.asked?.choices).toEqual(["once", "mode", "deny"])
  expect(first.asked?.preview?.title).toContain("(mới, 1 dòng)")
  expect(first.result.ok).toBe(true)
  expect(gate.mode).toBe("ask")
  // ▸ ask: the folder may be allowed for the session, never "always".
  const second = await viaGate(gate, s.write, { path: "ro-2.md", content: "y\n" }, "session")
  expect(second.asked?.choices).toEqual(["once", "session", "deny"])
  // The same folder for the session covers edit_file too (one approval group).
  await s.read.execute({ path: "ro-2.md" }, ctx())
  const third = await viaGate(gate, s.edit, { path: "ro-2.md", old_string: "y", new_string: "z" })
  expect(third.asked).toBeUndefined()
  expect(third.result.ok).toBe(true)
  // Back to read-only: session approvals stop counting for writes.
  gate.setMode("read-only")
  const fourth = await viaGate(gate, s.write, { path: "ro-3.md", content: "w\n" }, "deny")
  expect(fourth.asked?.choices).toEqual(["once", "mode", "deny"])
  expect(fourth.result.ok).toBe(false)
  expect(existsSync(path.join(project, "ro-3.md"))).toBe(false)
})

test("protected and outside writes ask each time with no session option; odd paths never run; deny rules win", async () => {
  const s = setup()
  const store = memoryStore({ deny: [{ tool: "write_file", pattern: path.join(project, "khoa", "*") }] })
  const gate = new PermissionGate(store)
  gate.interactive = true
  gate.setMode("ask")
  const prot = await viaGate(gate, s.write, { path: path.join(data, "config.json"), content: "{}" }, "deny")
  expect(prot.asked?.scope).toStartWith("protected:")
  expect(prot.asked?.choices).toEqual(["once", "deny"])
  const outside = await viaGate(gate, s.write, { path: path.join(root, "ngoai.md"), content: "x" }, "once")
  expect(outside.asked?.choices).toEqual(["once", "deny"])
  expect(outside.result.ok).toBe(true)
  const again = await viaGate(gate, s.write, { path: path.join(root, "ngoai-2.md"), content: "x" }, "deny")
  expect(again.asked).toBeDefined()
  const denied = await viaGate(gate, s.write, { path: path.join(project, "khoa", "a.md"), content: "x" })
  expect(denied.asked).toBeUndefined()
  expect(denied.result.output).toContain("quy tắc chặn")
  if (process.platform === "win32") {
    const odd = await viaGate(gate, s.write, { path: `${path.join(project, "a.md")}:stream`, content: "x" })
    expect(odd.asked).toBeUndefined()
    expect(odd.result.output).toContain("Không chạy được")
  }
  expect(store.saved).toBe(0)
})

test("ask rules force the prompt; choices never offer 'always' for file writes", async () => {
  const fake: ToolDef = { name: "mcp__x__create", description: "", input: z.object({}), readOnly: false, execute: async () => "ok" }
  expect(choicesFor(fake, undefined, "ask")).toEqual(["once", "session", "always", "deny"])
  expect(choicesFor({ ...fake, effect: "file" }, "edit:/x", "ask")).toEqual(["once", "session", "deny"])
  expect(choicesFor({ ...fake, effect: "shell" }, undefined, "read-only")).toEqual(["once", "mode", "deny"])
  // An existing write tool in read-only keeps its usual prompt (no "switch" option).
  expect(choicesFor(fake, undefined, "read-only")).toEqual(["once", "session", "always", "deny"])
  const gate = new PermissionGate(memoryStore({ ask: [{ tool: "mcp__x__*" }] }))
  gate.interactive = true
  const p1 = await viaGate(gate, fake, {}, "session")
  expect(p1.asked).toBeDefined()
  const p2 = await viaGate(gate, fake, {}, "once")
  expect(p2.asked).toBeDefined() // the ask rule beats the session approval
})

test("backups are secret to read, saved shell output is not; protected folders count inside the fallback workspace", async () => {
  const backup = path.join(data, "file-history", "2026-10-19-1", "0001-.env")
  const s = setup()
  expect(s.read.askFor?.({ path: backup })).toBe(`secret:${backup}`)
  // Saved shell output is the rest of what an approved command printed: readable to page through.
  expect(s.read.askFor?.({ path: path.join(data, "tool-output", "x.txt") })).toBeUndefined()
  expect(protectedWriteReason(path.join(data, "workspace", ".git", "hooks", "pre-commit"), env)).toContain(".git")
  expect(protectedWriteReason(path.join(data, "workspace", ".github", "workflows", "x.yml"), env)).toContain(".github")
  expect(protectedWriteReason(path.join(data, "workspace", "bao-cao", "x.md"), env)).toBeUndefined()
})

test("deny rules held in memory stop reads too; a folder allowed for the session covers its subfolders", async () => {
  const s = setup()
  writeFileSync(path.join(project, "rieng.md"), "bí mật riêng")
  const gate = new PermissionGate(memoryStore({ deny: [{ tool: "read_file", pattern: path.join(project, "rieng*") }] }))
  // Before refreshRules the read is not checked against rules (no config read per read).
  expect((await gate.check(s.read, { path: "rieng.md" }, new AbortController().signal)).allow).toBe(true)
  await gate.refreshRules()
  expect(await gate.check(s.read, { path: "rieng.md" }, new AbortController().signal)).toEqual({ allow: false, reason: "rule" })
  expect((await gate.check(s.read, { path: "ghi-chu.md" }, new AbortController().signal)).allow).toBe(true)

  gate.interactive = true
  gate.setMode("ask")
  mkdirSync(path.join(project, "bao-cao", "2026"), { recursive: true })
  const top = await viaGate(gate, s.write, { path: "bao-cao/a.md", content: "a\n" }, "session")
  expect(top.asked).toBeDefined()
  const deeper = await viaGate(gate, s.write, { path: "bao-cao/2026/b.md", content: "b\n" })
  expect(deeper.asked).toBeUndefined()
  expect(deeper.result.ok).toBe(true)
  const sibling = await viaGate(gate, s.write, { path: "khac/c.md", content: "c\n" }, "deny")
  expect(sibling.asked).toBeDefined()
})
