import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { answerUnattended } from "../scripts/eval/approvals"
import { PermissionGate } from "../src/core/permission"
import { initRuntime } from "../src/core/runtime"
import { loopDef } from "../src/core/tools/loop-guard"

const signal = new AbortController().signal
const page = { url: "https://example.com/bao-cao" }

async function setUp() {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-approvals-"))
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  return { gate, def: (name: string) => runtime.registry.get(name)!, clean: () => rm(home, { recursive: true, force: true }) }
}

test("with no responder, a page on a new domain is refused before anyone can answer", async () => {
  const { gate, def, clean } = await setUp()
  // What desk-eval did: a listener, but the gate never leaves its headless default.
  let heard = 0
  gate.onChange((head) => {
    if (head) heard++
  })
  expect(await gate.check(def("web_fetch"), page, signal)).toMatchObject({ allow: false, reason: "headless" })
  expect(heard).toBe(0)
  await clean()
})

test("unattended, web_fetch passes and everything that asks otherwise is refused", async () => {
  const { gate, def, clean } = await setUp()
  const stop = answerUnattended(gate, "eval")
  expect(await gate.check(def("web_fetch"), page, signal)).toMatchObject({ allow: true })
  // Read-only, and asks because the path is outside the workspace.
  expect(await gate.check(def("read_file"), { path: path.join(os.homedir(), ".ssh", "id_rsa") }, signal)).toMatchObject({ allow: false })
  expect(await gate.check(def("shell"), { command: "curl https://example.com" }, signal)).toMatchObject({ allow: false })
  expect(await gate.check(def("write_file"), { path: "a.txt", content: "x" }, signal)).toMatchObject({ allow: false })
  stop()
  expect(await gate.check(def("web_fetch"), page, signal)).toMatchObject({ allow: false, reason: "headless" })
  await clean()
})

test("a repeated call still stops: the loop guard's question is refused", async () => {
  const { gate, def, clean } = await setUp()
  answerUnattended(gate, "eval")
  expect(await gate.check(loopDef(def("web_fetch"), 3), page, signal)).toMatchObject({ allow: false })
  await clean()
})

test("parallel calls are all answered", async () => {
  const { gate, def, clean } = await setUp()
  answerUnattended(gate, "eval")
  const pages = ["a", "b", "c"].map((d) => gate.check(def("web_fetch"), { url: `https://${d}.example.com/` }, signal))
  expect((await Promise.all(pages)).map((d) => d.allow)).toEqual([true, true, true])
  await clean()
})
