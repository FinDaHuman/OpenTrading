import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { FileState } from "../src/core/fs/file-state"
import { isUncPath, readScope, resolveUserPath, secretReason, suspiciousWindowsPath } from "../src/core/fs/path-safety"
import { decodeFile, encodeFile, isBinary } from "../src/core/fs/text"
import { unsafeRoot, Workspace } from "../src/core/fs/workspace"
import { PermissionGate } from "../src/core/permission"
import { MAX_LINES, MAX_TEXT_CHARS, parsePages, readFileTool } from "../src/core/tools/fs/read"
import { globFilesTool, grepFilesTool } from "../src/core/tools/fs/search"
import type { ToolResult } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-fs-"))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const env = { home, data }
const ws = () => new Workspace(project, env)
const ctx = () => ({ signal: new AbortController().signal, callId: "c" })
const text = (r: string | ToolResult) => (typeof r === "string" ? r : r.output)

// ── path safety ────────────────────────────────────────────────────────────

test("secret paths: key files of OpenTrading, credential folders, .env (not templates), key files by name", () => {
  expect(secretReason(path.join(data, "auth.json"), env)).toContain("auth.json")
  expect(secretReason(path.join(data, "mcp-auth.json"), env)).toBeDefined()
  expect(secretReason(path.join(data, "config.json"), env)).toBeUndefined()
  expect(secretReason(path.join(home, ".ssh", "known_hosts"), env)).toContain(".ssh")
  expect(secretReason(path.join(home, ".git-credentials"), env)).toBeDefined()
  expect(secretReason(path.join(project, ".env"), env)).toBeDefined()
  expect(secretReason(path.join(project, ".env.production"), env)).toBeDefined()
  expect(secretReason(path.join(project, ".env.example"), env)).toBeUndefined()
  expect(secretReason(path.join(project, "id_ed25519"), env)).toBeDefined()
  expect(secretReason(path.join(project, "server.pem"), env)).toBeDefined()
  expect(secretReason(path.join(project, "bctc-fpt.pdf"), env)).toBeUndefined()
})

test("UNC and odd Windows spellings are recognised", () => {
  expect(isUncPath("\\\\server\\share\\a.pdf")).toBe(true)
  expect(isUncPath("//server/share/a.pdf")).toBe(true)
  expect(isUncPath("\\\\?\\C:\\a.txt")).toBe(false)
  expect(isUncPath("C:\\a.txt")).toBe(false)
  expect(suspiciousWindowsPath("C:\\a\\b.txt:secret", "win32")).toContain("data stream")
  expect(suspiciousWindowsPath("C:\\a\\NUL.txt", "win32")).toContain("thiết bị")
  expect(suspiciousWindowsPath("C:\\PROGRA~1\\x", "win32")).toContain("8.3")
  expect(suspiciousWindowsPath("C:\\a\\b. ", "win32")).toBeDefined()
  expect(suspiciousWindowsPath("C:\\Dau-tu\\ke-hoach.md", "win32")).toBeUndefined()
  expect(suspiciousWindowsPath("a.txt:x", "linux")).toBeUndefined()
})

test("user paths: quotes from drag-and-drop, ~, relative to the base", () => {
  expect(resolveUserPath('"' + path.join(project, "a b.pdf") + '"', project, home)).toBe(path.join(project, "a b.pdf"))
  expect(resolveUserPath("~/x.md", project, home)).toBe(path.join(home, "x.md"))
  expect(resolveUserPath("notes/a.md", project, home)).toBe(path.join(project, "notes", "a.md"))
})

// ── workspace ──────────────────────────────────────────────────────────────

test("workspace falls back to <data>/workspace when opened from home, a drive root, a top-level or the data folder", () => {
  expect(unsafeRoot(home, env)).toBe("thư mục home")
  expect(unsafeRoot(path.parse(root).root, env)).toBe("gốc ổ đĩa")
  expect(unsafeRoot(path.join(path.parse(root).root, "Windows"), env)).toBe("thư mục hệ thống cấp 1")
  expect(unsafeRoot(path.join(data, "sessions"), env)).toContain("dữ liệu")
  expect(unsafeRoot(project, env)).toBeUndefined()
  const fallback = new Workspace(home, env)
  expect(fallback.primary).toBe(path.join(data, "workspace"))
  expect(fallback.fallbackReason).toBe("thư mục home")
  expect(fallback.describe()).toContain("thư mục riêng")
  expect(ws().primary).toBe(project)
})

test("/add-dir adds a folder for the session; refuses missing, files, home and duplicates", () => {
  const w = ws()
  const extra = path.join(root, "bctc")
  mkdirSync(extra, { recursive: true })
  writeFileSync(path.join(extra, "f.txt"), "x")
  expect(w.add(extra)).toEqual({ dir: extra })
  expect(w.roots()).toEqual([project, extra])
  expect(w.describe()).toContain(extra)
  expect("error" in w.add(extra)).toBe(true)
  expect("error" in w.add(path.join(extra, "f.txt"))).toBe(true)
  expect("error" in w.add(path.join(root, "nope"))).toBe(true)
  const homeTry = w.add(home)
  expect("error" in homeTry && homeTry.error).toContain("quá rộng")
  expect(w.contains(path.join(extra, "new.md"))).toBe(true)
  expect(w.contains(path.join(root, "other", "x.md"))).toBe(false)
})

test("workspace membership resolves symlinks (a link inside pointing outside is outside)", () => {
  const outside = path.join(root, "outside")
  mkdirSync(outside, { recursive: true })
  const link = path.join(project, "link-out")
  try {
    symlinkSync(outside, link, "junction")
  } catch {
    return // no symlink rights on this machine
  }
  expect(ws().contains(path.join(link, "x.md"))).toBe(false)
  expect(ws().contains(path.join(project, "real.md"))).toBe(true)
})

// ── text helpers ───────────────────────────────────────────────────────────

test("text round-trips UTF-16LE (PowerShell 5.1), UTF-8 BOM and CRLF; binaries are detected", () => {
  const vi = "Lợi nhuận quý 3\r\ntăng 12%\r\n"
  for (const enc of ["utf8", "utf8-bom", "utf16le", "utf16be"] as const) {
    const decoded = decodeFile(encodeFile(vi, enc))
    expect(decoded.text).toBe(vi)
    expect(decoded.encoding).toBe(enc)
    expect(decoded.eol).toBe("\r\n")
  }
  expect(isBinary("a.txt", encodeFile(vi, "utf16le"))).toBe(false)
  expect(isBinary("a.bin", new Uint8Array([1, 0, 2]))).toBe(true)
  expect(isBinary("a.zip", new TextEncoder().encode("PK"))).toBe(true)
  expect(isBinary("a.csv", new TextEncoder().encode("ma,gia\nFPT,120\n"))).toBe(false)
})

// ── read_file ──────────────────────────────────────────────────────────────

test("read_file numbers lines, pages with offset/limit and records what was read", async () => {
  const file = path.join(project, "ghi-chu.md")
  writeFileSync(file, Array.from({ length: 30 }, (_, i) => `dòng ${i + 1}`).join("\n") + "\n")
  const state = new FileState()
  const tool = readFileTool(ws(), state)
  const all = text(await tool.execute({ path: "ghi-chu.md" }, ctx()))
  expect(all).toContain(`${file} · 30 dòng`)
  expect(all).toContain("1\tdòng 1")
  expect(all).toContain("30\tdòng 30")
  expect(state.get(file)?.full).toBe(true)
  const part = text(await tool.execute({ path: file, offset: 10, limit: 5 }, ctx()))
  expect(part).toContain("đang hiện dòng 10–14")
  expect(part).toContain("10\tdòng 10")
  expect(part).not.toContain("15\tdòng 15")
  expect(part).toContain("offset=15")
  // A partial read of unchanged bytes keeps the earlier full read.
  expect(state.get(file)?.full).toBe(true)
  const fresh = new FileState()
  await readFileTool(ws(), fresh).execute({ path: file, offset: 2 }, ctx())
  expect(fresh.get(file)?.full).toBe(false)
  await expect(tool.execute({ path: file, offset: 99 }, ctx())).rejects.toThrow("vượt quá")
})

test("read_file caps lines, line length and characters", async () => {
  const many = path.join(project, "many.txt")
  writeFileSync(many, Array.from({ length: MAX_LINES + 50 }, (_, i) => `r${i}`).join("\n"))
  const out = text(await readFileTool(ws()).execute({ path: many }, ctx()))
  expect(out).toContain(`đang hiện dòng 1–${MAX_LINES}`)
  expect(out).toContain(`offset=${MAX_LINES + 1}`)
  const wide = path.join(project, "wide.txt")
  writeFileSync(wide, `${"x".repeat(5000)}\n${"y".repeat(100)}\n`)
  const w = text(await readFileTool(ws()).execute({ path: wide }, ctx()))
  expect(w).toContain("dòng bị cắt, dài 5000 ký tự")
  const big = path.join(project, "big.txt")
  writeFileSync(big, Array.from({ length: 1500 }, () => "z".repeat(1000)).join("\n"))
  const b = text(await readFileTool(ws()).execute({ path: big }, ctx()))
  expect(b.length).toBeLessThan(MAX_TEXT_CHARS + 500)
  expect(b).toContain("đọc tiếp với offset=")
})

test("read_file decodes UTF-16 files written by PowerShell and refuses binaries", async () => {
  const ps = path.join(project, "ps-out.txt")
  writeFileSync(ps, encodeFile("Mã FPT\r\nGiá 120.000\r\n", "utf16le"))
  const out = text(await readFileTool(ws()).execute({ path: ps }, ctx()))
  expect(out).toContain("1\tMã FPT")
  expect(out).toContain("2\tGiá 120.000")
  const bin = path.join(project, "x.dat")
  writeFileSync(bin, new Uint8Array([0, 1, 2, 3, 0, 0]))
  await expect(readFileTool(ws()).execute({ path: bin }, ctx())).rejects.toThrow("nhị phân")
  const empty = path.join(project, "empty.txt")
  writeFileSync(empty, "")
  expect(text(await readFileTool(ws()).execute({ path: empty }, ctx()))).toContain("file rỗng")
})

test("read_file lists folders and suggests near names for a missing file", async () => {
  const dir = path.join(project, "bao-cao")
  mkdirSync(path.join(dir, "2026"), { recursive: true })
  writeFileSync(path.join(dir, "fpt-q3.md"), "# FPT")
  const listing = text(await readFileTool(ws()).execute({ path: "bao-cao" }, ctx()))
  expect(listing).toContain("1 thư mục, 1 file")
  expect(listing.indexOf("2026/")).toBeLessThan(listing.indexOf("fpt-q3.md"))
  await expect(readFileTool(ws()).execute({ path: "bao-cao/fpt-q4.md" }, ctx())).rejects.toThrow("fpt-q3.md")
})

test("read_file returns images as images and PDFs page by page", async () => {
  const png = path.join(project, "chart.png")
  writeFileSync(png, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  const img = await readFileTool(ws()).execute({ path: png }, ctx())
  expect(typeof img).toBe("object")
  expect((img as ToolResult).images?.[0]?.mediaType).toBe("image/png")
  const pdf = path.join(project, "bctc.pdf")
  writeFileSync(
    pdf,
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 98>>stream
BT /F1 12 Tf 20 40 Td (Bao cao ket qua kinh doanh quy 3 nam 2026 cua cong ty co phan ABC dat ke hoach) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`,
  )
  const out = text(await readFileTool(ws()).execute({ path: pdf }, ctx()))
  expect(out).toContain("1 trang")
  expect(out).toContain("--- Trang 1 ---")
  expect(out).toContain("Bao cao ket qua kinh doanh")
  await expect(readFileTool(ws()).execute({ path: pdf, pages: "abc" }, ctx())).rejects.toThrow("không hợp lệ")
  expect(parsePages("2,4-6", 10)).toEqual([2, 4, 5, 6])
  expect(parsePages("8-20", 10)).toEqual([8, 9, 10])
  expect(typeof parsePages("11", 10)).toBe("string")
})

test("reading a key file asks first, per exact path, and never offers 'always'", async () => {
  writeFileSync(path.join(data, "auth.json"), '{"google":"sk-test"}')
  const tool = readFileTool(ws())
  expect(tool.askFor?.({ path: path.join(data, "auth.json") })).toBe(`secret:${path.join(data, "auth.json")}`)
  expect(tool.askFor?.({ path: path.join(project, "ghi-chu.md") })).toBeUndefined()
  expect(tool.askFor?.({ path: "\\\\fileserver\\share\\bctc.pdf" })).toStartWith("unc:")
  // Headless: nobody to ask, so the read never happens.
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  await expect(runTool(tool, { path: path.join(data, "auth.json") }, ctx(), new RwLock(), gate)).rejects.toThrow("cần người dùng xác nhận")
  // "always" on a key file is downgraded to the session, nothing is saved.
  let saved = 0
  const ui = new PermissionGate({ load: async () => [], save: async () => void saved++ })
  ui.interactive = true
  const pending = ui.check(tool, { path: path.join(data, "auth.json") }, new AbortController().signal)
  await new Promise((r) => setTimeout(r, 5))
  await ui.respond(ui.head()!.id, "always")
  expect(await pending).toEqual({ allow: true })
  expect(saved).toBe(0)
})

// ── glob_files / grep_files ────────────────────────────────────────────────

test("glob_files matches names at any depth, newest first, and skips .git, node_modules and key files", async () => {
  const dir = path.join(root, "glob")
  mkdirSync(path.join(dir, "sub", "deep"), { recursive: true })
  mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true })
  mkdirSync(path.join(dir, ".git"), { recursive: true })
  writeFileSync(path.join(dir, "a.csv"), "x")
  writeFileSync(path.join(dir, "sub", "deep", "b.csv"), "x")
  writeFileSync(path.join(dir, "node_modules", "pkg", "c.csv"), "x")
  writeFileSync(path.join(dir, ".git", "d.csv"), "x")
  writeFileSync(path.join(dir, "note.md"), "x")
  writeFileSync(path.join(dir, ".env"), "KEY=1")
  const old = new Date(Date.now() - 86_400_000)
  utimesSync(path.join(dir, "a.csv"), old, old)
  const tool = globFilesTool(ws())
  const out = text(await tool.execute({ pattern: "*.csv", path: dir }, ctx()))
  expect(out).toContain("2 file khớp")
  expect(out.indexOf("b.csv")).toBeLessThan(out.indexOf("a.csv"))
  expect(out).not.toContain("c.csv")
  expect(out).not.toContain("d.csv")
  expect(text(await tool.execute({ pattern: "sub/**/*.csv", path: dir }, ctx()))).toContain("1 file khớp")
  expect(text(await tool.execute({ pattern: ".env*", path: dir }, ctx()))).toContain("Không có file nào")
  expect(text(await tool.execute({ pattern: "*.xlsx", path: dir }, ctx()))).toContain("Không có file nào")
  await expect(tool.execute({ pattern: "*", path: path.join(dir, "a.csv") }, ctx())).rejects.toThrow("không phải thư mục")
})

test("grep_files: files, content with context and count; key files and binaries are never opened", async () => {
  const dir = path.join(root, "grep")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "fpt.md"), "Tổng quan\nFPT lãi 12%\nGhi chú\nFPT chia cổ tức\n")
  writeFileSync(path.join(dir, "vcb.md"), "VCB lãi 8%\n")
  writeFileSync(path.join(dir, ".env"), "FPT_KEY=sk-secret\n")
  writeFileSync(path.join(dir, "blob.bin"), new Uint8Array([70, 80, 84, 0, 1]))
  writeFileSync(path.join(dir, "ps.txt"), encodeFile("FPT từ PowerShell\r\n", "utf16le"))
  const tool = grepFilesTool(ws())
  const files = text(await tool.execute({ pattern: "FPT", path: dir }, ctx()))
  expect(files).toContain("fpt.md")
  expect(files).toContain("ps.txt")
  expect(files).not.toContain(".env")
  expect(files).not.toContain("blob.bin")
  const content = text(await tool.execute({ pattern: "fpt", path: dir, ignore_case: true, output_mode: "content", context: 1, glob: "*.md" }, ctx()))
  expect(content).toContain(`${path.join(dir, "fpt.md")}:2:FPT lãi 12%`)
  expect(content).toContain(`${path.join(dir, "fpt.md")}:1-Tổng quan`)
  expect(content).not.toContain("ps.txt")
  const count = text(await tool.execute({ pattern: "lãi", path: dir, output_mode: "count" }, ctx()))
  expect(count).toContain(`${path.join(dir, "fpt.md")}:1`)
  expect(count).toContain(`${path.join(dir, "vcb.md")}:1`)
  const limited = text(await tool.execute({ pattern: "FPT", path: dir, output_mode: "content", head_limit: 1 }, ctx()))
  expect(limited).toContain("hiện 1/")
  await expect(tool.execute({ pattern: "(", path: dir }, ctx())).rejects.toThrow("không hợp lệ")
  expect(text(await tool.execute({ pattern: "không-có", path: dir }, ctx()))).toContain("Không tìm thấy")
})

test("a search rooted in a credential folder asks first; grep from home never reads auth.json", async () => {
  mkdirSync(path.join(home, ".ssh"), { recursive: true })
  writeFileSync(path.join(home, ".ssh", "id_rsa"), "sk-private")
  writeFileSync(path.join(data, "auth.json"), '{"k":"sk-private"}')
  writeFileSync(path.join(home, "notes.txt"), "sk-public-note")
  const w = new Workspace(project, env)
  expect(grepFilesTool(w).askFor?.({ pattern: "sk-", path: path.join(home, ".ssh") })).toStartWith("secret:")
  expect(globFilesTool(w).askFor?.({ pattern: "*", path: path.join(home, ".ssh") })).toStartWith("secret:")
  expect(grepFilesTool(w).askFor?.({ pattern: "sk-", path: home })).toBeUndefined()
  const out = text(await grepFilesTool(w).execute({ pattern: "sk-", path: home }, ctx()))
  expect(out).toContain("notes.txt")
  expect(out).not.toContain("auth.json")
  expect(out).not.toContain("id_rsa")
})

const w32 = String.raw

test("Windows: a top-level folder such as D:\\Dau-tu is a fine workspace; system folders and drive roots are not", () => {
  const win = { home: w32`C:\Users\ban`, data: w32`C:\Users\ban\.opentrading`, platform: "win32" as const }
  expect(unsafeRoot(w32`D:\Dau-tu`, win)).toBeUndefined()
  expect(unsafeRoot(w32`D:\BCTC`, win)).toBeUndefined()
  expect(unsafeRoot(w32`C:\Users\ban\Documents\Dau-tu`, win)).toBeUndefined()
  expect(unsafeRoot(w32`C:\Windows`, win)).toBe("thư mục hệ thống cấp 1")
  expect(unsafeRoot(w32`C:\Users`, win)).toBe("thư mục hệ thống cấp 1")
  expect(unsafeRoot(w32`c:\program files`, win)).toBe("thư mục hệ thống cấp 1")
  expect(unsafeRoot(w32`D:\ `.trim(), win)).toBe("gốc ổ đĩa")
  expect(unsafeRoot(w32`c:\users\BAN`, win)).toBe("thư mục home")
  expect(unsafeRoot("/srv", { home: "/home/ban", data: "/home/ban/.opentrading", platform: "linux" })).toBe("thư mục hệ thống cấp 1")
})

test("read scope: network paths (also via file://), odd Windows spellings and symlinks to key files ask first", () => {
  const win = { home: w32`C:\Users\ban`, data: w32`C:\Users\ban\.opentrading`, platform: "win32" as const }
  expect(readScope(w32`\\srv\share\bctc.pdf`, win)).toBe(w32`unc:\\srv\share\bctc.pdf`)
  expect(readScope(w32`C:\Users\ban\.opentrading\auth.json::$DATA`, win)).toStartWith("odd:")
  expect(readScope(w32`C:\Users\ban\.opentrading\auth.json.`, win)).toStartWith("odd:")
  expect(readScope(w32`C:\Users\RUNNER~1\AppData\Local\Temp\a.txt`, win)).toBeUndefined()
  expect(readScope(w32`C:\Users\ban\.ssh`, win)).toStartWith("secret:")
  expect(readScope(w32`D:\Dau-tu\ghi-chu.md`, win)).toBeUndefined()
  // file://server/share and \\server\share resolve to a UNC path before the check (Windows).
  const w = ws()
  if (process.platform === "win32") {
    expect(readFileTool(w).askFor?.({ path: "file://srv/share/x.pdf" })).toStartWith("unc:")
    expect(grepFilesTool(w).askFor?.({ pattern: "x", path: w32`\\srv\share` })).toStartWith("unc:")
  }
  // A harmlessly named link that leads to auth.json.
  writeFileSync(path.join(data, "auth.json"), '{"k":"sk-private"}')
  const link = path.join(project, "notes-link.txt")
  try {
    symlinkSync(path.join(data, "auth.json"), link, "file")
  } catch {
    return // no symlink rights on this machine
  }
  expect(readFileTool(w).askFor?.({ path: link })).toBe(`secret:${link}`)
  expect(grepFilesTool(w).askFor?.({ pattern: "sk-", path: link })).toBe(`secret:${link}`)
})

test("on Windows an alternate data stream of a key file asks", () => {
  if (process.platform !== "win32") return
  expect(readFileTool(ws()).askFor?.({ path: `${path.join(data, "auth.json")}::$DATA` })).toStartWith("odd:")
})
