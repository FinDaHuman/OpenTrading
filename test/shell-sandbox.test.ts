import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseCli } from "../src/cli/args"
import { shellSandboxOn } from "../src/core/config"
import { Workspace } from "../src/core/fs/workspace"
import { shellTool } from "../src/core/tools/shell/shell"
import { bwrapArgv, probeSandbox, sandboxDescription, sandboxedArgv, sandboxNotice, seatbeltArgv, type SandboxStatus } from "../src/core/tools/shell/sandbox"

// Issue #352: the shell tool's optional OS sandbox.

const root = mkdtempSync(path.join(os.tmpdir(), "ot-sandbox-"))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ctx = (callId = "c") => ({ signal: new AbortController().signal, callId })
const ws = (dir = project) => new Workspace(dir, { home, data })
const READY_BWRAP: SandboxStatus = { kind: "ready", tool: "bwrap", path: "/usr/bin/bwrap" }
const MISSING: SandboxStatus = { kind: "missing", tool: "bwrap" }
const WINDOWS: SandboxStatus = { kind: "unsupported", platform: "win32" }

// ── switch: flag and config ─────────────────────────────────────────────────

test("--sandbox is parsed for the TUI and for -p; absent means off", () => {
  expect(parseCli(["--sandbox"])).toMatchObject({ kind: "tui", sandbox: true })
  expect(parseCli(["--yolo", "--sandbox", "du-an"])).toMatchObject({ kind: "tui", yolo: true, sandbox: true, dir: "du-an" })
  expect(parseCli(["-p", "câu hỏi", "--sandbox"])).toMatchObject({ kind: "print", prompt: "câu hỏi", sandbox: true })
  expect(parseCli([])).not.toHaveProperty("sandbox")
  expect(parseCli(["-p", "x"])).not.toHaveProperty("sandbox")
})

test("the sandbox is on with the flag or shell.sandbox: true, off by default", () => {
  expect(shellSandboxOn({})).toBe(false)
  expect(shellSandboxOn({ shell: {} })).toBe(false)
  expect(shellSandboxOn({ shell: { sandbox: false } })).toBe(false)
  expect(shellSandboxOn({ shell: { sandbox: true } })).toBe(true)
  expect(shellSandboxOn({}, true)).toBe(true)
  expect(shellSandboxOn({ shell: { sandbox: false } }, true)).toBe(true)
})

// ── what the user and the model are told ───────────────────────────────────

test("Windows: a clear warning that nothing is isolated, and the model is told nothing about a sandbox", () => {
  const notice = sandboxNotice(true, WINDOWS)
  expect(notice?.level).toBe("warning")
  expect(notice?.text).toContain("Windows chưa có cách ly")
  expect(notice?.text).toContain("chạy thẳng trên máy")
  expect(sandboxDescription(true, WINDOWS)).toBeUndefined()
  // No recommendation to turn on what would not isolate anything.
  expect(sandboxNotice(false, WINDOWS, { bypass: true })).toBeUndefined()
})

test("notices: missing bwrap says how to install it and that every command is refused; ready says what is blocked; off says nothing outside bypass", () => {
  const missing = sandboxNotice(true, MISSING)
  expect(missing?.level).toBe("warning")
  expect(missing?.text).toContain("bubblewrap")
  expect(missing?.text).toContain("bị từ chối")
  const broken = sandboxNotice(true, { kind: "broken", tool: "bwrap", path: "/usr/bin/bwrap", detail: "setting up uid map: Permission denied" })
  expect(broken?.text).toContain("uid map")
  expect(broken?.text).toContain("user namespace")
  expect(sandboxNotice(true, READY_BWRAP)).toEqual({ level: "info", text: expect.stringContaining("không có mạng") })
  expect(sandboxNotice(false, READY_BWRAP)).toBeUndefined()
  // ▸▸▸ without the sandbox: recommended once.
  expect(sandboxNotice(false, MISSING, { bypass: true })?.text).toContain("--sandbox")
})

test("a sandbox that cannot run gives the model an English error, never the bare command", () => {
  const result = sandboxedArgv(MISSING, { writable: [project], readOnly: [] }, ["/bin/sh", "-c", "true"], project)
  expect(result).toEqual({ error: expect.stringContaining("The command did not run") })
  expect((result as { error: string }).error).toContain("bwrap is not installed")
  // Windows: the command as it is (the user was warned).
  expect(sandboxedArgv(WINDOWS, { writable: [project], readOnly: [] }, ["pwsh", "-c", "1"], project)).toEqual(["pwsh", "-c", "1"])
})

// ── argv ───────────────────────────────────────────────────────────────────

test("bwrap argv: read-only root, no network, workspace and temp writable, data folder read-only over them, a workspace inside it opened again", () => {
  const inner = path.join(data, "workspace")
  mkdirSync(inner, { recursive: true })
  const real = (p: string) => realpathSync(p)
  const argv = bwrapArgv("/usr/bin/bwrap", { writable: [project, root, inner, path.join(root, "khong-co")], readOnly: [data] }, ["/bin/bash", "-c", "echo hi"], project)
  expect(argv.slice(0, 4)).toEqual(["/usr/bin/bwrap", "--ro-bind", "/", "/"])
  for (const flag of ["--unshare-net", "--unshare-pid", "--die-with-parent"]) expect(argv).toContain(flag)
  const at = (flag: string, dir: string) => argv.findIndex((a, i) => a === flag && argv[i + 1] === real(dir))
  expect(at("--bind", project)).toBeGreaterThan(0)
  expect(at("--ro-bind", data)).toBeGreaterThan(at("--bind", root))
  // The reopened workspace comes after the read-only data folder (later binds win).
  expect(argv.lastIndexOf(real(inner))).toBeGreaterThan(at("--ro-bind", data))
  // A folder that does not exist is not bound (bwrap would refuse to start).
  expect(argv.some((a) => a.includes("khong-co"))).toBe(false)
  // The command after "--", untouched.
  expect(argv.slice(argv.indexOf("--") + 1)).toEqual(["/bin/bash", "-c", "echo hi"])
  expect(argv[argv.indexOf("--chdir") + 1]).toBe(project)
})

test("sandbox-exec argv: paths go in as -D parameters, never into the profile text", () => {
  // A folder name that would be profile syntax if pasted in (quotes are not allowed in Windows names).
  const odd = path.join(root, process.platform === "win32" ? "quote) (allow network" : 'quote") (allow network*')
  mkdirSync(odd, { recursive: true })
  const argv = seatbeltArgv("/usr/bin/sandbox-exec", { writable: [odd], readOnly: [data] }, ["/bin/bash", "-c", "true"])
  const profile = argv[argv.indexOf("-p") + 1]!
  expect(profile).toContain("(deny network*)")
  expect(profile).toContain('(subpath (param "W0"))')
  expect(profile).not.toContain("quote")
  expect(argv).toContain(`W0=${realpathSync(odd)}`)
  expect(argv).toContain(`R0=${realpathSync(data)}`)
  expect(argv.slice(-3)).toEqual(["/bin/bash", "-c", "true"])
})

// ── the tool ───────────────────────────────────────────────────────────────

test("shell tool: on and unable to run, nothing is spawned and the model reads why", async () => {
  const marker = path.join(project, "khong-duoc-tao.txt")
  const tool = shellTool(ws(), { sandbox: true, sandboxStatus: () => MISSING })
  const command = process.platform === "win32" ? `Set-Content -Path '${marker}' -Value x` : `echo x > '${marker}'`
  await expect(tool.execute({ command }, ctx())).rejects.toThrow("The command did not run")
  expect(existsSync(marker)).toBe(false)
})

test("shell tool: the description names the sandbox only when it isolates", () => {
  const on = shellTool(ws(), { sandbox: true, sandboxStatus: () => READY_BWRAP })
  const off = shellTool(ws(), { sandbox: false, sandboxStatus: () => READY_BWRAP })
  const win = shellTool(ws(), { sandbox: true, sandboxStatus: () => WINDOWS })
  expect(on.descriptionFor!(new Set(["shell"]), "bypass")).toContain("Commands run in a sandbox: no network")
  expect(off.descriptionFor!(new Set(["shell"]), "bypass")).not.toContain("sandbox")
  expect(win.descriptionFor!(new Set(["shell"]), "bypass")).not.toContain("sandbox")
})

test("shell tool on Windows with the sandbox on: the command runs (not isolated, the user was warned)", async () => {
  const tool = shellTool(ws(), { sandbox: true, sandboxStatus: () => WINDOWS })
  const out = await tool.execute({ command: "echo da-chay" }, ctx())
  expect(String(out)).toContain("da-chay")
})

// ── the real sandbox (Linux: bwrap, macOS: sandbox-exec) ───────────────────

const unix = process.platform === "linux" || process.platform === "darwin"
const status = unix ? probeSandbox() : WINDOWS
const real = status.kind === "ready"

// Linux CI installs bubblewrap: there the real tests must run, never skip quietly.
// Linux CI installs bubblewrap (ci.yml quality): there the real tests must run, never skip quietly.
test.if(process.platform === "linux" && !!process.env.CI)("Linux CI: bubblewrap is installed and works", () => {
  expect(status).toMatchObject({ kind: "ready", tool: "bwrap" })
})

test.if(process.platform === "darwin" && !!process.env.CI)("macOS CI: sandbox-exec works", () => {
  expect(status).toMatchObject({ kind: "ready", tool: "sandbox-exec" })
})

const run = async (command: string, opts: { sandbox: boolean; dir?: string; timeout_ms?: number }) =>
  String(await shellTool(ws(opts.dir), { sandbox: opts.sandbox }).execute({ command, ...(opts.timeout_ms ? { timeout_ms: opts.timeout_ms } : {}) }, ctx()))

test.if(real)("sandboxed: a write outside the workspace and temp is blocked; the same write in the workspace works", async () => {
  // Home is outside both the workspace and the temp folder (on CI and on a dev machine).
  const outside = path.join(os.homedir(), `.ot-sandbox-probe-${process.pid}-${Date.now()}`)
  try {
    const blocked = await run(`echo x > '${outside}'; echo "exit=$?"`, { sandbox: true })
    expect(blocked).not.toContain("exit=0")
    expect(existsSync(outside)).toBe(false)
    // Control: the same command without the sandbox writes there (so the path itself is fine).
    expect(await run(`echo x > '${outside}' && echo ok`, { sandbox: false })).toContain("ok")
    expect(existsSync(outside)).toBe(true)
  } finally {
    rmSync(outside, { force: true })
  }
  const inside = path.join(project, "trong-workspace.txt")
  expect(await run(`echo trong > '${inside}' && echo ok`, { sandbox: true })).toContain("ok")
  expect(readFileSync(inside, "utf8").trim()).toBe("trong")
  const tmp = path.join(os.tmpdir(), `ot-sandbox-tmp-${process.pid}.txt`)
  try {
    expect(await run(`echo tam > '${tmp}' && echo ok`, { sandbox: true })).toContain("ok")
  } finally {
    rmSync(tmp, { force: true })
  }
})

test.if(real)("sandboxed: OpenTrading's data folder stays read-only even inside the temp folder; a workspace inside it stays writable", async () => {
  const config = path.join(data, "config.json")
  writeFileSync(config, "{}")
  const out = await run(`echo '{"shell":{"sandbox":false}}' > '${config}'; echo "exit=$?"`, { sandbox: true })
  expect(out).not.toContain("exit=0")
  expect(readFileSync(config, "utf8")).toBe("{}")
  const inner = path.join(data, "workspace")
  mkdirSync(inner, { recursive: true })
  expect(await run(`echo x > '${path.join(inner, "a.txt")}' && echo ok`, { sandbox: true, dir: inner })).toContain("ok")
  expect(await run(`echo x > '${config}'; echo "exit=$?"`, { sandbox: true, dir: inner })).not.toContain("exit=0")
  expect(readFileSync(config, "utf8")).toBe("{}")
})

test.if(real)("sandboxed: no network, even to a listener on 127.0.0.1 (control: reachable without the sandbox)", async () => {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } })
  try {
    // bash's /dev/tcp: no DNS, no outside service, so a flaky runner network cannot fake a pass.
    const connect = `bash -c 'exec 3<>/dev/tcp/127.0.0.1/${server.port}' && echo connected || echo refused`
    expect(await run(connect, { sandbox: false })).toContain("connected")
    const sandboxed = await run(connect, { sandbox: true })
    expect(sandboxed).toContain("refused")
    expect(sandboxed).not.toContain("connected")
  } finally {
    server.stop(true)
  }
})

test.if(real)("sandboxed: exit codes come through, arithmetic still works, and a timeout still kills the children", async () => {
  expect(await run("exit 3", { sandbox: true })).toContain("exit code 3")
  expect(await run("awk 'BEGIN{print 2+3}'", { sandbox: true })).toContain("5")
  const started = Date.now()
  const out = await run("sleep 30 & wait", { sandbox: true, timeout_ms: 1500 })
  expect(out).toContain("stopped after")
  expect(Date.now() - started).toBeLessThan(10_000)
})
