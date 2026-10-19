import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { PermissionGate, type AllowRule } from "../src/core/permission"
import { commandPrefix, criticalDelete, isSimpleCommand, mentionsSensitive, startsInterpreter } from "../src/core/tools/shell/command"
import { SHELL_OUTPUT_CHARS, shellTool } from "../src/core/tools/shell/shell"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-shell-"))
const data = path.join(root, "home", ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const win = process.platform === "win32"
const w32 = String.raw
const ws = () => new Workspace(project, { home: path.join(root, "home"), data })
const ctx = (callId = "c") => ({ signal: new AbortController().signal, callId })
const text = (r: string | { output: string }) => (typeof r === "string" ? r : r.output)

// ── command analysis ───────────────────────────────────────────────────────

test("simple commands and their prefixes; chains, pipes, redirection and substitution are not simple", () => {
  expect(commandPrefix("git status -s")).toBe("git status")
  expect(commandPrefix("npm run build -- --watch")).toBe("npm run build")
  expect(commandPrefix("Get-ChildItem -Recurse")).toBe("get-childitem")
  expect(commandPrefix("pip install pandas")).toBe("pip install")
  for (const c of ["git status; Remove-Item -Recurse x", "git status && rm -rf x", "ls | grep a", "echo a > b.txt", "echo $(whoami)", "echo `id`", "a\nb", "Get-Item @(1)"]) {
    expect(isSimpleCommand(c)).toBe(false)
    expect(commandPrefix(c)).toBeUndefined()
  }
  expect(startsInterpreter("python phan_tich.py")).toBe(true)
  expect(startsInterpreter("C:\\Python312\\python.exe -c 1")).toBe(true)
  expect(startsInterpreter("npx some-tool")).toBe(true)
  expect(startsInterpreter("git log")).toBe(false)
})

test("recursive deletes of a root, a drive, home, a system folder or the workspace never run", () => {
  const env = { roots: [w32`C:\Users\ban`, w32`D:\Dau-tu`] }
  for (const c of [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf ~/",
    "sudo rm -rf /usr",
    'rm -fr "$HOME"',
    "rm -rf ./*",
    "rm -rf .",
    "Remove-Item -Recurse -Force C:\\",
    w32`Remove-Item C:\Users\ban\* -Recurse`,
    w32`ri -r -fo D:\Dau-tu`,
    w32`rd /s /q C:\Windows`,
    "cmd /c rmdir /s /q D:\\",
    "Remove-Item -Rec $env:USERPROFILE",
    w32`echo ok; Remove-Item -Recurse C:\Users`,
  ]) {
    expect(criticalDelete(c, env)).toBeDefined()
  }
  for (const c of ["rm -rf build", "rm -rf ./dist/cache", w32`Remove-Item -Recurse D:\Dau-tu\tmp`, "rm note.txt", "Remove-Item a.txt", "git rm -r --cached x"]) {
    expect(criticalDelete(c, env)).toBeUndefined()
  }
})

test("commands naming key files, OpenTrading's config or login autostart are flagged", () => {
  expect(mentionsSensitive("Get-Content ~/.opentrading/auth.json")).toBeDefined()
  expect(mentionsSensitive(w32`Set-Content $HOME\.opentrading\config.json '{}'`)).toBeDefined()
  expect(mentionsSensitive("cat .env")).toBeDefined()
  expect(mentionsSensitive("cat ~/.ssh/id_rsa")).toBeDefined()
  expect(mentionsSensitive("Add-Content $PROFILE 'x'")).toBeDefined()
  expect(mentionsSensitive("schtasks /create /tn x")).toBeDefined()
  expect(mentionsSensitive("powershell -ExecutionPolicy Bypass -File x.ps1")).toBeDefined()
  expect(mentionsSensitive("python phan_tich.py data.csv")).toBeUndefined()
  expect(mentionsSensitive("echo environment")).toBeUndefined()
})

// ── the tool and the gate ──────────────────────────────────────────────────

test("scopes: a simple command by prefix, others exactly; outside the workspace and sensitive ones are user-only", () => {
  const tool = shellTool(ws())
  expect(tool.askFor?.({ command: "git status -s" })).toBe("cmd:git status")
  expect(tool.askFor?.({ command: "git status; rm x" })).toBe("cmd!git status; rm x")
  expect(tool.askFor?.({ command: "python phan_tich.py" })).toBe("cmd!python phan_tich.py")
  expect(tool.askFor?.({ command: "ls", workdir: root })).toBe(`outside:${root}`)
  expect(tool.askFor?.({ command: "type auth.json" })).toStartWith("protected:")
  expect(tool.blockFor?.({ command: "rm -rf ~" })).toContain("xoá đệ quy")
})

test("an 'always' rule for git status runs git status -s but never a chained command; read-only asks anyway", async () => {
  const rules: AllowRule[] = [{ tool: "shell", scope: "native#cmd:git status" }]
  const gate = new PermissionGate({ load: async () => rules, save: async () => {} })
  const tool = shellTool(ws())
  gate.setMode("ask")
  const signal = new AbortController().signal
  expect(await gate.check(tool, { command: "git status -s" }, signal)).toEqual({ allow: true })
  // Not interactive: anything that has to ask is denied, which proves it was not pre-approved.
  expect((await gate.check(tool, { command: "git status; Remove-Item -Recurse x" }, signal)).reason).toBe("headless")
  expect((await gate.check(tool, { command: "git status | Out-File x" }, signal)).reason).toBe("headless")
  gate.setMode("read-only")
  expect((await gate.check(tool, { command: "git status -s" }, signal)).reason).toBe("headless")
  expect(await gate.check(tool, { command: "rm -rf /" }, signal)).toMatchObject({ allow: false, reason: "blocked" })
})

test("choices: prefix commands may be allowed always, chained/interpreter ones for the session only", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.interactive = true
  gate.setMode("ask")
  const tool = shellTool(ws())
  const ask = async (command: string) => {
    const p = gate.check(tool, { command }, new AbortController().signal)
    for (let i = 0; i < 200 && !gate.head(); i++) await new Promise((r) => setTimeout(r, 5))
    const head = gate.head()!
    await gate.respond(head.id, "deny")
    await p
    return head
  }
  expect((await ask("git log -5")).choices).toEqual(["once", "session", "always", "deny"])
  expect((await ask("python x.py")).choices).toEqual(["once", "session", "deny"])
  const sensitive = await ask("type .env")
  expect(sensitive.choices).toEqual(["once", "deny"])
  expect(sensitive.preview?.title).toContain(project)
})

// ── running ────────────────────────────────────────────────────────────────

test("runs in the workspace, returns UTF-8 output and the exit code", async () => {
  const tool = shellTool(ws())
  const out = text(await tool.execute({ command: win ? "Write-Output 'Lợi nhuận quý 3'; (Get-Location).Path" : "printf 'Lợi nhuận quý 3\\n'; pwd" }, ctx()))
  expect(out).toContain("mã thoát 0")
  expect(out).toContain("Lợi nhuận quý 3")
  expect(out.toLowerCase()).toContain(path.basename(project).toLowerCase())
  const failed = text(await tool.execute({ command: win ? "Write-Output 'trước'; cmd /c exit 3" : "echo trước; exit 3" }, ctx()))
  expect(failed).toContain("mã thoát 3")
  expect(failed).toContain("trước")
  if (win) {
    const err = text(await tool.execute({ command: "Write-Error 'hỏng rồi'" }, ctx()))
    expect(err).toContain("LỖI: hỏng rồi")
    expect(err).not.toContain("CLIXML")
    expect(err).toContain("mã thoát 1")
  }
  expect(await tool.validate!({ command: "ls", workdir: path.join(project, "khong-co") })).toContain("Không có thư mục")
}, 30_000)

test("a timeout kills the command and says so", async () => {
  const tool = shellTool(ws())
  const started = Date.now()
  const out = text(await tool.execute({ command: win ? "Start-Sleep -Seconds 30" : "sleep 30", timeout_ms: 1500 }, ctx()))
  expect(out).toContain("dừng vì quá 2s")
  expect(Date.now() - started).toBeLessThan(15_000)
}, 30_000)

test("long output is saved to a file the model can read; the result keeps the head with that path", async () => {
  const tool = shellTool(ws())
  const command = win ? '1..4000 | ForEach-Object { "dòng $_ abcdefghijklmnopqrstuvwxyz" }' : 'for i in $(seq 1 4000); do echo "dòng $i abcdefghijklmnopqrstuvwxyz"; done'
  const result = await runTool(tool, { command }, ctx("call-dai"), new RwLock())
  expect(result.output.length).toBeLessThanOrEqual(SHELL_OUTPUT_CHARS + 2_200)
  const file = path.join(data, "tool-output", "call-dai.txt")
  expect(result.output).toContain(file)
  expect(existsSync(file)).toBe(true)
  expect(readFileSync(file, "utf8")).toContain("dòng 4000 ")
  expect(result.output).toContain("dòng 1 ")
  expect(result.output).toContain("dòng 4000 ")
}, 60_000)
