import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { countedFetch } from "../src/core/requests"
import { RequestLedger } from "../scripts/eval/ledger"
import { requestCap } from "../scripts/eval/request-cap"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("#350: requests are counted at fetch, refused past the cap, and an arm reports what it really sent", async () => {
  globalThis.fetch = (async () => new Response("{}")) as unknown as typeof fetch
  const send = countedFetch("p", "m")
  const meter = requestCap(3)
  // An arm that retries: 2 real requests, whatever it claims.
  const arm = await meter.measure(async () => {
    await send("https://x")
    await send("https://x")
    return { requests: 1 }
  })
  expect(arm.requests).toBe(2)
  await send("https://x")
  expect(meter.refused).toBe(false)
  await expect(send("https://x")).rejects.toThrow("Eval request cap reached (3/3)")
  expect(meter.sent).toBe(3)
  expect(meter.capped).toBe(true)
  expect(meter.refused).toBe(true)
  meter.stop()
  // Stopped: no guard left behind for later code.
  await send("https://x")
})

test("#350: the day's ledger cap holds across runs", async () => {
  globalThis.fetch = (async () => new Response("{}")) as unknown as typeof fetch
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-cap-"))
  const file = path.join(dir, "day.json")
  const send = countedFetch("p", "m")
  const first = requestCap(100, await RequestLedger.open(file, "p/m", 2))
  await first.measure(async () => (await send("https://x"), { requests: 0 }))
  first.stop()
  const second = requestCap(100, await RequestLedger.open(file, "p/m", 2))
  await send("https://x")
  await expect(send("https://x")).rejects.toThrow("Daily request cap reached (2/2)")
  second.stop()
  await rm(dir, { recursive: true, force: true })
})
