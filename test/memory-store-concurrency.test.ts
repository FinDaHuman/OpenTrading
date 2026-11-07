import path from "node:path"
import { writeFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { MemoryStoreError } from "../src/core/memory/store/errors"
import { MIGRATIONS } from "../src/core/memory/store/schema"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()
const contender = path.join(import.meta.dir, "fixtures", "scripts", "memory-store-contender.ts")

/**
 * Children started by the running test. Each test kills them in `finally`: a child left running
 * keeps memory.db open, and on Windows the temp folder then cannot be removed.
 */
const children: ReturnType<typeof Bun.spawn>[] = []

async function killChildren() {
  for (const child of children.splice(0)) {
    child.kill()
    await child.exited
  }
}

/** A child running the contender script, with its stdout read line by line. */
function spawn(...args: string[]) {
  const child = Bun.spawn([process.execPath, contender, ...args], { stdout: "pipe", stderr: "inherit" })
  children.push(child)
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return {
    child,
    async line(): Promise<string> {
      for (;;) {
        const at = buffer.indexOf("\n")
        if (at >= 0) {
          const line = buffer.slice(0, at).trim()
          buffer = buffer.slice(at + 1)
          return line
        }
        const { value, done } = await reader.read()
        if (done) return buffer.trim()
        buffer += decoder.decode(value, { stream: true })
      }
    },
  }
}

test("two processes revising the same constraint from the same version: one saves, the other conflicts", async () => {
  t.open().writer.addConstraint({ kind: "constraint", text: "Bản 1" })
  const go = path.join(t.dir(), "go")
  try {
    const a = spawn("revise", t.file(), go)
    const b = spawn("revise", t.file(), go)
    expect(await a.line()).toBe("ready")
    expect(await b.line()).toBe("ready")
    writeFileSync(go, "")
    const results = [await a.line(), await b.line()].sort()
    await Promise.all([a.child.exited, b.child.exited])
    expect(results).toEqual(["conflict", "ok"])
  } finally {
    await killChildren()
  }
  const raw = t.raw()
  expect(raw.query("SELECT max(version) AS v, count(*) AS n FROM constraint_versions").get()).toEqual({ v: 2, n: 2 })
}, 20_000)

test("a contender whose start signal never comes gives up on its own", async () => {
  t.open().writer.addConstraint({ kind: "constraint", text: "Bản 1" })
  try {
    const lone = spawn("revise", t.file(), path.join(t.dir(), "never"), "300")
    expect(await lone.line()).toBe("ready")
    expect(await lone.line()).toBe("timeout")
    expect(await lone.child.exited).toBe(0)
  } finally {
    await killChildren()
  }
}, 10_000)

test("a write waiting on another process's lock fails as busy in under 2 seconds and saves nothing", async () => {
  const { reader, writer } = t.open()
  try {
    const holder = spawn("hold", t.file(), "3000")
    expect(await holder.line()).toBe("held")
    const started = performance.now()
    let error: unknown
    try {
      writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
    } catch (e) {
      error = e
    }
    const waited = performance.now() - started
    expect(error).toBeInstanceOf(MemoryStoreError)
    expect((error as MemoryStoreError).kind).toBe("busy")
    expect(waited).toBeLessThan(2000)
    await holder.child.exited
  } finally {
    await killChildren()
  }
  expect(reader.constraints("constraint")).toEqual([])
}, 20_000)

test("opening an up-to-date store needs no write lock: it opens while another process is writing", async () => {
  t.open().close()
  try {
    const holder = spawn("hold", t.file(), "3000")
    expect(await holder.line()).toBe("held")
    const store = t.open({ busyTimeoutMs: 200 })
    expect(store.reader.constraints("constraint")).toEqual([])
  } finally {
    await killChildren()
  }
}, 20_000)

test("a store that needs migrating cannot be migrated while another process writes: busy, to be retried", async () => {
  t.open().close()
  try {
    const holder = spawn("hold", t.file(), "3000")
    expect(await holder.line()).toBe("held")
    let error: unknown
    try {
      t.open({ busyTimeoutMs: 200, migrations: [...MIGRATIONS, () => {}] })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(MemoryStoreError)
    expect((error as MemoryStoreError).kind).toBe("busy")
  } finally {
    await killChildren()
  }
}, 20_000)

test("changed() sees another connection's write once, and this connection's own writes", () => {
  const a = t.open()
  const b = t.open()
  expect(a.changed()).toBe(false)
  b.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  expect(a.changed()).toBe(true)
  expect(a.changed()).toBe(false)
  a.writer.addConstraint({ kind: "style", text: "Trả lời ngắn" })
  expect(a.changed()).toBe(true)
  expect(a.changed()).toBe(false)
})

test("a busy timeout that is not a finite, non-negative number falls back to the 1-second default", async () => {
  // SQLite reads "PRAGMA busy_timeout = NaN" as 0 without an error: a bad option would silently mean "never wait".
  for (const busyTimeoutMs of [Number.NaN, -5]) {
    const { writer } = t.open({ busyTimeoutMs })
    try {
      const holder = spawn("hold", t.file(), "2500")
      expect(await holder.line()).toBe("held")
      const started = performance.now()
      let error: unknown
      try {
        writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
      } catch (e) {
        error = e
      }
      const waited = performance.now() - started
      expect((error as MemoryStoreError).kind).toBe("busy")
      expect({ busyTimeoutMs, waitedAtLeast800: waited >= 800 }).toEqual({ busyTimeoutMs, waitedAtLeast800: true })
    } finally {
      await killChildren()
    }
  }
}, 30_000)
