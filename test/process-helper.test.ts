import { expect, test } from "bun:test"
import { waitForOutput } from "./helpers/process"

test("readiness fails with captured stdout when the child exits before taking the lock", async () => {
  const child = Bun.spawn([process.execPath, "-e", 'console.log("startup failed"); process.exit(7)'], { stdout: "pipe", stderr: "pipe" })
  await expect(waitForOutput(child.stdout, "held")).rejects.toThrow('child stdout ended before "held"; stdout: startup failed')
  expect(await child.exited).toBe(7)
})

test("readiness times out for a live child that never prints its marker", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("starting")) } })
  await expect(waitForOutput(stream, "held", 20)).rejects.toThrow('within 20 ms; stdout: starting')
})
