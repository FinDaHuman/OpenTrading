/**
 * The desk demo without a terminal: drives the real App headless and writes text frames of
 * the approval card, the live card, the finished run and /desk to `<out>/*.txt`.
 *
 *   bun scripts/dev/desk-demo-frames.tsx <out-dir>
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const out = path.resolve(process.argv[2] ?? "desk-frames")
const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-desk-frames-"))
process.env.OPENTRADING_HOME = home
for (const name of Object.keys(process.env)) if (/(API_?KEY|TOKEN|SECRET)$/i.test(name)) delete process.env[name]

const { installFakeModel, MODEL } = await import("./desk-demo-model")
installFakeModel({ speed: 0.3 })
const { setKey } = await import("../../src/core/auth")
const { saveConfig } = await import("../../src/core/config")
await setKey("nvidia", "demo-key-khong-dung-duoc")
await saveConfig({ provider: "nvidia", model: MODEL, desk: { staggerMs: 200 } } as never)

const { testRender } = await import("@opentui/solid")
const { App } = await import("../../src/tui/app")
const { state } = await import("../../src/tui/state")
const { initRuntime } = await import("../../src/core/runtime")
const runtime = initRuntime({ skills: () => state.skills })
const setup = await testRender(() => <App runtime={runtime} onExit={() => {}} />, { width: 110, height: 48, exitOnCtrlC: false })
setup.renderer.requestLive()
await mkdir(out, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean, ms = 120_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) {
      console.log(JSON.stringify(state.lines.slice(-6), null, 1).slice(0, 3000), Boolean(state.deskApproval), JSON.stringify(Object.values(state.deskRuns).map((r) => [r.status, r.error, r.agents.length])))
      throw new Error("timeout")
    }
    await setup.renderOnce()
    await sleep(100)
  }
}
async function save(name: string) {
  await setup.renderOnce()
  await writeFile(path.join(out, `${name}.txt`), setup.captureCharFrame())
  console.log(`frame ${name}`)
}

await until(() => state.connected.length > 0 && Boolean(state.model))
await setup.mockInput.typeText("ultradesk so sánh FPT, MWG, VNM, HPG, VCB, ACB theo ROE")
await save("0-prompt")
setup.mockInput.pressEnter()
await until(() => Boolean(state.deskApproval), 20_000)
await save("1-approval")
await sleep(500)
setup.mockInput.pressEnter()
await until(() => !state.deskApproval, 10_000)
await until(() => Object.values(state.deskRuns).some((r) => r.agents.some((a) => a.status === "running")))
await sleep(2500)
await save("2-running")
await until(() => Object.values(state.deskRuns).some((r) => r.phases.filter((p) => p.total > 0).length >= 2 && r.status === "running"), 240_000).catch(() => {})
await save("3-later")
setup.mockInput.typeText("/desk")
setup.mockInput.pressEnter()
await sleep(800)
await save("4-desk")
setup.mockInput.pressEscape()
await until(() => Object.values(state.deskRuns).every((r) => r.status !== "running" && r.status !== "paused"), 300_000)
await until(() => !state.streaming)
await sleep(1500)
await save("5-done")
setup.renderer.destroy()
process.exit(0)
