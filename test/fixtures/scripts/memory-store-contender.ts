// Child process for memory-store-concurrency.test.ts.
//   revise <file> <go> [waitMs]  open the store, print "ready", wait for the <go> file (at most waitMs,
//                       default 15 s, then print "timeout" and exit), revise constraint #1 from
//                       version 1, print "ok" or the error kind.
//   hold <file> <ms>    take the write lock (BEGIN IMMEDIATE), print "held", keep it <ms>, commit.
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { MemoryStoreError } from "../../../src/core/memory/store/errors"
import { openMemoryStore } from "../../../src/core/memory/store/open"

const [mode, file, arg, waitArg] = process.argv.slice(2) as [string, string, string, string | undefined]

if (mode === "revise") {
  const store = openMemoryStore(file)
  console.log("ready")
  // Bounded: a test that fails before writing <go> must not leave this process holding the store.
  const deadline = Date.now() + Number(waitArg ?? 15_000)
  while (!existsSync(arg) && Date.now() < deadline) await Bun.sleep(2)
  if (!existsSync(arg)) {
    console.log("timeout")
    store.close()
    process.exit(0)
  }
  try {
    store.writer.reviseConstraint(1, 1, { text: `Bản của tiến trình ${process.pid}` })
    console.log("ok")
  } catch (error) {
    console.log(error instanceof MemoryStoreError ? error.kind : `error ${String(error)}`)
  } finally {
    store.close()
  }
} else {
  const db = new Database(file, { strict: true })
  db.run("BEGIN IMMEDIATE")
  db.run("UPDATE counters SET value = value WHERE name = 'constraint_set'")
  console.log("held")
  await Bun.sleep(Number(arg))
  db.run("COMMIT")
  db.close(true)
}
