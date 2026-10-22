import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installShims, onPath, pathHint, SHIM_MARK, shimFiles, uninstallShims } from "../src/cli/install"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-install-"))
  dirs.push(dir)
  return dir
}

test("Windows gets .cmd shims for cmd/PowerShell and bare sh shims for Git Bash", () => {
  const bun = "C:\\npm\\node_modules\\bun\\bin\\bun.exe"
  const files = shimFiles({ root: "D:\\Code\\OpenTrading", dir: "C:\\bin", bun, platform: "win32" })
  expect(files.map((f) => path.basename(f.file)).sort()).toEqual(["opentrading", "opentrading.cmd", "ot", "ot.cmd"])
  const cmd = files.find((f) => f.file.endsWith("opentrading.cmd"))!.content
  expect(cmd).toContain("@echo off")
  // The bun.exe that ran the install (npm's bun.cmd would add a batch layer); bun on PATH if it moved.
  expect(cmd).toContain(`set "OT_BUN=${bun}"`)
  expect(cmd).toContain('if not exist "%OT_BUN%" set "OT_BUN=bun"')
  expect(cmd).toContain('"%OT_BUN%" --config="D:\\Code\\OpenTrading\\src\\cli\\launcher.bunfig.toml"')
  expect(cmd).toContain("--no-env-file --no-install")
  expect(cmd).toContain('"D:\\Code\\OpenTrading\\src\\index.tsx" %*')
  expect(cmd).toContain("\r\n")
  const sh = files.find((f) => f.file.endsWith(`${path.sep}ot`))!.content
  expect(sh.startsWith("#!/bin/sh\n")).toBe(true)
  expect(sh).toContain(`b='C:/npm/node_modules/bun/bin/bun.exe'; [ -x "$b" ] || b=bun`)
  expect(sh).toContain("exec \"$b\" --config='D:/Code/OpenTrading/src/cli/launcher.bunfig.toml' --no-env-file --no-install 'D:/Code/OpenTrading/src/index.tsx' \"$@\"")
})

test("macOS/Linux get sh shims only; quotes and % in paths are escaped", () => {
  const files = shimFiles({ root: "/home/an/it's", dir: "/home/an/.local/bin", platform: "linux" })
  expect(files.map((f) => path.basename(f.file)).sort()).toEqual(["opentrading", "ot"])
  expect(files[0]!.content).toContain(`'/home/an/it'\\''s/src/index.tsx'`)
  const cmd = shimFiles({ root: "D:\\100%", dir: "C:\\bin", platform: "win32" })[0]!.content
  expect(cmd).toContain("D:\\100%%\\src\\index.tsx")
})

test("install is repeatable, never overwrites someone else's file, uninstall removes only ours", async () => {
  const dir = await temp()
  const root = await temp()
  await writeFile(path.join(dir, "ot"), "#!/bin/sh\necho someone else's ot\n")
  if (process.platform === "win32") await writeFile(path.join(dir, "ot.cmd"), "@echo off\necho other\n")

  const first = await installShims({ root, dir })
  expect(first.skipped.map((f) => path.basename(f)).sort()).toEqual(process.platform === "win32" ? ["ot", "ot.cmd"] : ["ot"])
  const written = first.written.map((f) => path.basename(f)).sort()
  expect(written).toEqual(process.platform === "win32" ? ["opentrading", "opentrading.cmd"] : ["opentrading"])
  const before = await readFile(path.join(dir, "opentrading"), "utf8")
  expect(before).toContain(SHIM_MARK)
  if (process.platform !== "win32") expect((await stat(path.join(dir, "opentrading"))).mode & 0o111).not.toBe(0)

  const second = await installShims({ root, dir })
  expect(second.written.map((f) => path.basename(f)).sort()).toEqual(written)
  expect(await readFile(path.join(dir, "opentrading"), "utf8")).toBe(before)
  expect(await readFile(path.join(dir, "ot"), "utf8")).toContain("someone else's ot")

  const removed = await uninstallShims({ root, dir })
  expect(removed.map((f) => path.basename(f)).sort()).toEqual(written)
  expect((await readdir(dir)).sort()).toEqual(process.platform === "win32" ? ["ot", "ot.cmd"] : ["ot"])
})

test("onPath compares normalised entries (case-insensitive on Windows)", () => {
  expect(onPath("C:\\Users\\An\\.local\\bin", "C:\\Windows;c:\\users\\an\\.local\\bin\\", "win32")).toBe(true)
  expect(onPath("C:\\Users\\An\\.local\\bin", "C:\\Windows", "win32")).toBe(false)
  expect(onPath("/home/an/.local/bin", "/usr/bin:/home/an/.local/bin/", "linux")).toBe(true)
  expect(onPath("/home/an/.local/bin", "/usr/bin:/home/AN/.local/bin", "linux")).toBe(false)
})

test("PATH hints fit the shell, and never edit anything themselves", () => {
  expect(pathHint("C:\\Users\\An\\.local\\bin", "win32")).toContain('SetEnvironmentVariable("Path"')
  expect(pathHint("/home/an/.local/bin", "linux", "/usr/bin/zsh")).toContain("~/.zshrc")
  expect(pathHint("/home/an/.local/bin", "linux", "/bin/bash")).toContain("~/.bashrc")
  expect(pathHint("/home/an/.local/bin", "darwin", "/opt/homebrew/bin/fish")).toContain("fish_add_path")
})
