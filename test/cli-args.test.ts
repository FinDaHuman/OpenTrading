import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseCli, resolveDir } from "../src/cli/args"

const repo = path.resolve(import.meta.dir, "..")
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-cli-"))
  dirs.push(dir)
  return dir
}

test("no arguments opens the TUI in the current folder", () => {
  expect(parseCli([])).toEqual({ kind: "tui", dir: undefined, resume: undefined })
})

test("a folder, with or without resume flags, in any order", () => {
  expect(parseCli(["D:\\Test\\Try1"])).toEqual({ kind: "tui", dir: "D:\\Test\\Try1", resume: undefined })
  expect(parseCli([".", "-c"])).toEqual({ kind: "tui", dir: ".", resume: "latest" })
  expect(parseCli(["--continue", ".."])).toEqual({ kind: "tui", dir: "..", resume: "latest" })
})

test("-r takes a session id but never a folder", () => {
  expect(parseCli(["-r", "20261022-140500-ab12"])).toEqual({ kind: "tui", dir: undefined, resume: "20261022-140500-ab12" })
  expect(parseCli(["-r"])).toEqual({ kind: "tui", dir: undefined, resume: "latest" })
  expect(parseCli(["-r", "."])).toEqual({ kind: "tui", dir: ".", resume: "latest" })
  expect(parseCli(["-r", "D:\\Test"])).toEqual({ kind: "tui", dir: "D:\\Test", resume: "latest" })
  expect(parseCli(["--resume", "-c"])).toEqual({ kind: "tui", dir: undefined, resume: "latest" })
  expect(parseCli(["--resume=abc1"])).toEqual({ kind: "tui", dir: undefined, resume: "abc1" })
})

test("mcp stays a subcommand with its own arguments", () => {
  expect(parseCli(["mcp", "list", "--help"])).toEqual({ kind: "mcp", args: ["list", "--help"] })
  // A folder named mcp: ./mcp
  expect(parseCli(["./mcp"])).toEqual({ kind: "tui", dir: "./mcp", resume: undefined })
})

test("help, version, unknown flags and two folders", () => {
  expect(parseCli(["-h"]).kind).toBe("help")
  expect(parseCli([".", "--help"]).kind).toBe("help")
  expect(parseCli(["--version"]).kind).toBe("version")
  expect(parseCli(["-v"]).kind).toBe("version")
  const unknown = parseCli(["--yolo"])
  expect(unknown.kind).toBe("error")
  expect(unknown.kind === "error" && unknown.message).toContain("--yolo")
  expect(parseCli(["a", "b"]).kind).toBe("error")
})

test("resolveDir: relative to cwd, missing folder and plain file are errors", async () => {
  const base = await temp()
  await mkdir(path.join(base, "Try1"))
  await writeFile(path.join(base, "note.txt"), "x")
  expect(resolveDir("Try1", base)).toEqual({ path: path.join(base, "Try1") })
  expect(resolveDir(path.join(base, "Try1"), "/elsewhere")).toEqual({ path: path.join(base, "Try1") })
  expect(resolveDir("..", path.join(base, "Try1"))).toEqual({ path: base })
  expect("error" in resolveDir("nope", base)).toBe(true)
  expect("error" in resolveDir("note.txt", base)).toBe(true)
})

/** The shim's command line, run from a folder with a hostile bunfig.toml and .env. */
async function hostile() {
  const dir = await temp()
  await writeFile(path.join(dir, "bunfig.toml"), 'preload = ["./marker.ts"]\n')
  await writeFile(path.join(dir, "marker.ts"), 'console.log("FOLDER-PRELOAD-RAN")\n')
  await writeFile(path.join(dir, ".env"), "OPENTRADING_HOME=FROM_FOLDER_DOTENV\n")
  return dir
}
const shimFlags = [`--config=${path.join(repo, "src", "cli", "launcher.bunfig.toml")}`, "--no-env-file", "--no-install"]

test("shim flags: the folder's bunfig preload and .env never load", async () => {
  const cwd = await hostile()
  const probe = path.join(cwd, "probe.ts")
  await writeFile(probe, "console.log('HOME=' + process.env.OPENTRADING_HOME)\n")
  const run = Bun.spawnSync([process.execPath, ...shimFlags, probe], { cwd, env: { ...process.env, OPENTRADING_HOME: "FROM_PARENT" }, stdout: "pipe", stderr: "pipe" })
  const out = run.stdout.toString()
  expect(out).not.toContain("FOLDER-PRELOAD-RAN")
  expect(out).toContain("HOME=FROM_PARENT")
  expect(out).not.toContain("FROM_FOLDER_DOTENV")
})

test("--version and errors work from another folder, without the TUI", async () => {
  const cwd = await hostile()
  const index = path.join(repo, "src", "index.tsx")
  const version = Bun.spawnSync([process.execPath, ...shimFlags, index, "--version"], { cwd, stdout: "pipe", stderr: "pipe" })
  expect(version.exitCode).toBe(0)
  expect(version.stdout.toString()).toMatch(/^opentrading \d+\.\d+\.\d+/)
  expect(version.stdout.toString()).toContain(repo)
  const missing = Bun.spawnSync([process.execPath, ...shimFlags, index, "khong-co-thu-muc-nay"], { cwd, stdout: "pipe", stderr: "pipe" })
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr.toString()).toContain("Không có thư mục")
})

test("the Solid transform loads from another folder the way src/index.tsx does it", async () => {
  // Regression: bunfig.toml's preload is read from the cwd only, so the TUI's JSX failed to
  // compile anywhere but the repo. index.tsx now imports the preload itself.
  const cwd = await hostile()
  const probe = path.join(cwd, "probe.ts")
  const preload = JSON.stringify(Bun.resolveSync("@opentui/solid/preload", repo))
  const main = JSON.stringify(path.join(repo, "src", "tui", "main.tsx"))
  await writeFile(probe, `await import(${preload})\nconst m = await import(${main})\nconsole.log("TUI-MODULE", typeof m.startTui)\n`)
  const run = Bun.spawnSync([process.execPath, ...shimFlags, probe], { cwd, stdout: "pipe", stderr: "pipe" })
  expect(run.stderr.toString()).not.toContain("error:")
  expect(run.stdout.toString()).toContain("TUI-MODULE function")
}, 30_000)
