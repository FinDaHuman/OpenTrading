/**
 * Ultradesk in action without an API key: the real TUI, engine, subagents and cards, with a
 * scripted model in place of the provider.
 *
 *   bun scripts/dev/desk-demo.tsx
 *
 * Then type, for example:  ultradesk so sánh FPT, MWG, VNM, HPG, VCB, ACB theo ROE
 * and press enter on the approval card. The run plays out in the chat card and in /desk.
 *
 * Safety: state lives in a fresh temp OPENTRADING_HOME (never ~/.opentrading), provider key
 * variables are removed, and every network request except the fake provider is refused, so
 * this script can never spend a real key or reach a real server. Numbers are random.
 */
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-desk-demo-"))
process.env.OPENTRADING_HOME = home
for (const name of Object.keys(process.env)) if (/(API_?KEY|TOKEN|SECRET)$/i.test(name)) delete process.env[name]

const { installFakeModel, MODEL } = await import("./desk-demo-model")
installFakeModel()
const { setKey } = await import("../../src/core/auth")
const { saveConfig } = await import("../../src/core/config")
await setKey("nvidia", "demo-key-khong-dung-duoc")
await saveConfig({ provider: "nvidia", model: MODEL, desk: { staggerMs: 300 } } as never)

console.log(`Ultradesk demo · OPENTRADING_HOME=${home}`)
console.log("Gõ: ultradesk so sánh FPT, MWG, VNM, HPG, VCB, ACB theo ROE  → enter trên thẻ duyệt.")
await new Promise((r) => setTimeout(r, 1200))
const { startTui } = await import("../../src/tui/main")
await startTui(undefined)
