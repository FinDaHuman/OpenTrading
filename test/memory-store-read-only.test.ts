import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, spyOn, test } from "bun:test"
import { MemoryStoreError } from "../src/core/memory/store/errors"
import { openStoreReadOnly, readOnlyDisk } from "../src/core/memory/store/read-only"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()
const contender = path.join(import.meta.dir, "fixtures", "scripts", "memory-store-contender.ts")

/** The error kind openStoreReadOnly throws, or "none". */
function kindOf(file: string) {
  try {
    const store = openStoreReadOnly(file)
    if (store.state === "open") store.close()
    return "none"
  } catch (error) {
    return error instanceof MemoryStoreError ? error.kind : `other ${String(error)}`
  }
}

/** A store with constraints #1 (version 2), #2 (style) and #3, then closed. */
function seeded(name?: string) {
  const store = t.open({}, name)
  store.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  store.writer.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })
  store.writer.addConstraint({ kind: "style", text: "Trả lời ngắn" })
  store.writer.addConstraint({ kind: "constraint", text: "Tối đa 20% danh mục cho một mã" })
  store.close()
}

describe("openStoreReadOnly", () => {
  test("no file: missing, and nothing is created (not even the folder's -wal/-shm)", () => {
    expect(openStoreReadOnly(t.file()).state).toBe("missing")
    expect(readdirSync(t.dir())).toEqual([])
    expect(openStoreReadOnly(path.join(t.dir(), "no-such-folder", "memory.db")).state).toBe("missing")
    expect(existsSync(path.join(t.dir(), "no-such-folder"))).toBe(false)
  })

  test("an empty file (a first open that never got to build the schema): empty", () => {
    writeFileSync(t.file(), "")
    expect(openStoreReadOnly(t.file()).state).toBe("empty")
    expect(readFileSync(t.file()).length).toBe(0)
  })

  test("a version-1 store: open, constraints read through the policy gate", () => {
    seeded()
    const store = openStoreReadOnly(t.file())
    expect(store.state).toBe("open")
    if (store.state !== "open") return
    try {
      const sub = store.gate.read("subagent", "system")
      expect(sub.map((i) => [i.kind, i.fields.id, i.fields.version, i.fields.text])).toEqual([
        ["constraint", 1, 2, "Không dùng margin, kể cả T+0"],
        ["constraint", 3, 1, "Tối đa 20% danh mục cho một mã"],
      ])
      // The main agent's rules also let style out; the gate, not this module, decides.
      expect(store.gate.read("main_agent", "system").map((i) => i.kind)).toEqual(["constraint", "constraint", "style"])
      // No writer and no connection handle on the result (presence and tombstones are reads for the redaction check).
      expect(Object.keys(store).sort()).toEqual(["close", "gate", "presence", "state", "tombstones"])
    } finally {
      store.close()
    }
  })

  test("newer schema, a file that is not a store, damaged data: the right kind, the file left byte for byte", () => {
    seeded("newer.db")
    t.raw("newer.db").run("PRAGMA user_version = 99")
    writeFileSync(t.file("text.db"), "Đây là ghi chú, không phải SQLite. ".repeat(20))
    seeded("foreign.db")
    t.raw("foreign.db").run("PRAGMA application_id = 1234")
    seeded("damaged.db")
    // A valid header and first page, garbage after: the open succeeds, the read finds the damage.
    const good = readFileSync(t.file("damaged.db"))
    const bad = Buffer.from(good)
    for (let i = 4096; i < bad.length; i++) bad[i] = (i * 37) & 255
    writeFileSync(t.file("damaged.db"), bad)
    seeded("page1.db")
    const bad1 = Buffer.from(readFileSync(t.file("page1.db")))
    for (let i = 100; i < bad1.length; i++) bad1[i] = (i * 37) & 255
    writeFileSync(t.file("page1.db"), bad1)

    const files = ["newer.db", "text.db", "foreign.db", "damaged.db", "page1.db"]
    const before = files.map((f) => readFileSync(t.file(f)))
    const damagedRead = () => {
      const store = openStoreReadOnly(t.file("damaged.db"))
      if (store.state !== "open") return store.state
      try {
        store.gate.read("subagent", "system")
        return "read"
      } catch (error) {
        return error instanceof MemoryStoreError ? error.kind : "other"
      } finally {
        store.close()
      }
    }

    expect(kindOf(t.file("newer.db"))).toBe("newer_schema")
    expect(kindOf(t.file("text.db"))).toBe("not_a_store")
    expect(kindOf(t.file("foreign.db"))).toBe("not_a_store")
    expect(kindOf(t.file("page1.db"))).toBe("corrupt")
    expect(damagedRead()).toBe("corrupt")
    files.forEach((f, i) => expect(Buffer.compare(readFileSync(t.file(f)), before[i]!)).toBe(0))
  })

  test("the newer-schema message names the file", () => {
    seeded()
    t.raw().run("PRAGMA user_version = 99")
    expect(() => openStoreReadOnly(t.file())).toThrow(t.file())
  })

  test("an older store is never migrated: user_version stays", () => {
    seeded()
    const raw = t.raw()
    raw.run("PRAGMA user_version = 0")
    // Version 0 with tables and our application id: treated as nothing to read, and left at 0.
    expect(openStoreReadOnly(t.file()).state).toBe("empty")
    expect((raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0)
  })

  test("the file goes between the look and the open: missing, nothing created", () => {
    // The look says the file is there; it is not (another window moved it away a moment before).
    const exists = spyOn(readOnlyDisk, "exists").mockImplementationOnce(() => true)
    try {
      expect(openStoreReadOnly(t.file()).state).toBe("missing")
      expect(readdirSync(t.dir())).toEqual([])
    } finally {
      exists.mockRestore()
    }
  })

  test("the connection is closed: the folder can go at once (Windows keeps open files locked)", () => {
    seeded()
    const store = openStoreReadOnly(t.file())
    if (store.state === "open") {
      store.gate.read("subagent", "system")
      store.close()
      store.close()
    }
    // Rename works on every OS only when no handle is open on Windows.
    const moved = t.file("moved.db")
    renameSync(t.file(), moved)
    expect(existsSync(moved)).toBe(true)
  })

  test("another process holds the write lock for a moment: the store still opens and reads", async () => {
    seeded()
    const child = Bun.spawn([process.execPath, contender, "hold", t.file(), "300"], { stdout: "pipe", stderr: "inherit" })
    try {
      const reader = child.stdout.getReader()
      let out = ""
      while (!out.includes("held")) {
        const { value, done } = await reader.read()
        if (done) break
        out += new TextDecoder().decode(value)
      }
      expect(out).toContain("held")
      const store = openStoreReadOnly(t.file(), { busyTimeoutMs: 1000 })
      expect(store.state).toBe("open")
      if (store.state === "open") {
        try {
          expect(store.gate.read("subagent", "system")).toHaveLength(2)
        } finally {
          store.close()
        }
      }
    } finally {
      child.kill()
      await child.exited
    }
  })
})
