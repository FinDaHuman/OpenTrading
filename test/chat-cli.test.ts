import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { removeTempDir } from "./helpers/temp"
import os from "node:os"
import path from "node:path"
import { openMemoryStore } from "../src/core/memory/store/open"

// The provider check without the TUI (`bun src/core/chat.ts "…"`): a source that fails to read must stop
// it with an error before anything is sent. No provider is configured in the temp home, so a request
// would first fail with "Chưa kết nối provider": the hold must come before that.
const repo = path.join(import.meta.dir, "..")
let home = ""
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "ot-chat-cli-"))
})
afterEach(async () => {
  await removeTempDir(home)
})

async function chat(question: string) {
  const env: Record<string, string | undefined> = { ...process.env, OPENTRADING_HOME: home, NO_COLOR: "1" }
  // No key from the developer's environment may turn this into a real request.
  for (const name of Object.keys(env)) if (/API_KEY$|_TOKEN$/.test(name)) delete env[name]
  const child = Bun.spawn([process.execPath, path.join(repo, "src", "core", "chat.ts"), question], {
    cwd: repo,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

test("INVESTOR.md cannot be read: the reason, a non-zero exit, and no provider reached", async () => {
  mkdirSync(path.join(home, "INVESTOR.md"))
  const run = await chat("HPG thế nào?")
  expect(run.code).not.toBe(0)
  expect(run.stderr).toContain(
    "Chưa gửi câu hỏi: không đọc được hồ sơ nhà đầu tư (INVESTOR.md): đường dẫn là thư mục, không phải file.",
  )
  expect(run.stderr).not.toContain("provider")
}, 60_000)

test("memory.db from a newer build: the reason with its way out, a non-zero exit, the file untouched", async () => {
  const file = path.join(home, "memory.db")
  const store = openMemoryStore(file)
  store.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  store.close()
  const { Database } = await import("bun:sqlite")
  const raw = new Database(file)
  raw.run("PRAGMA user_version = 99")
  raw.close(true)
  const before = readFileSync(file)
  const run = await chat("HPG thế nào?")
  expect(run.code).not.toBe(0)
  expect(run.stderr).toContain(`không đọc được ràng buộc trong kho memory (${file}): kho do phiên bản OpenTrading mới hơn tạo.`)
  expect(run.stderr).toContain("OpenTrading không tự xoá hay sửa file này.")
  expect(run.stderr).not.toContain("provider")
  expect(Buffer.compare(readFileSync(file), before)).toBe(0)
}, 60_000)
