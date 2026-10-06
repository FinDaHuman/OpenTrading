import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  addHistory,
  HistoryCursor,
  historyEntries,
  historyFile,
  historyFlushed,
  loadHistory,
  MAX_RECALL,
  resetHistory,
  searchHistory,
} from "../src/tui/prompt/history"

const saved = process.env.OPENTRADING_HOME
let home = ""

beforeEach(async () => {
  await historyFlushed()
  home = await mkdtemp(path.join(os.tmpdir(), "opentrading-history-"))
  process.env.OPENTRADING_HOME = home
  resetHistory()
})

afterAll(async () => {
  await historyFlushed()
  resetHistory()
  if (saved === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = saved
  await rm(home, { recursive: true, force: true })
})

test("history: appended to a jsonl file, blanks and repeats of the newest skipped", async () => {
  await loadHistory()
  addHistory("câu một")
  addHistory("câu một")
  addHistory("   ")
  addHistory("/model")
  await historyFlushed()
  expect(historyEntries()).toEqual(["/model", "câu một"])
  const lines = (await readFile(historyFile(), "utf8")).trim().split("\n")
  expect(lines.map((l) => JSON.parse(l).text)).toEqual(["câu một", "/model"])
  if (process.platform !== "win32") expect((await stat(historyFile())).mode & 0o777).toBe(0o600)
})

test("history: loads the newest entries, skips a torn line and trims a long file", async () => {
  const many = Array.from({ length: 600 }, (_, i) => JSON.stringify({ text: `p${i}`, ts: i }))
  await writeFile(historyFile(), [...many, '{"text": "torn'].join("\n"))
  await loadHistory()
  expect(historyEntries()).toHaveLength(MAX_RECALL)
  expect(historyEntries()[0]).toBe("p599")
  await historyFlushed()
  const kept = (await readFile(historyFile(), "utf8")).trim().split("\n")
  expect(kept).toHaveLength(MAX_RECALL)
  expect(JSON.parse(kept.at(-1)!).text).toBe("p599")
})

test("history: ↑/↓ cursor keeps the draft and restarts once the recalled text is edited", async () => {
  await loadHistory()
  for (const t of ["a", "b", "c"]) addHistory(t)
  const cursor = new HistoryCursor()
  expect(cursor.down("draft")).toBeUndefined()
  expect(cursor.up("draft")).toBe("c")
  expect(cursor.up("c")).toBe("b")
  expect(cursor.up("b")).toBe("a")
  expect(cursor.up("a")).toBeUndefined()
  expect(cursor.down("a")).toBe("b")
  expect(cursor.down("b")).toBe("c")
  expect(cursor.down("c")).toBe("draft")
  // Editing a recalled entry makes it the new draft.
  expect(cursor.up("draft")).toBe("c")
  expect(cursor.up("c edited")).toBe("c")
  expect(cursor.down("c")).toBe("c edited")
})

test("history: search is case-insensitive, newest first, without duplicates", async () => {
  await loadHistory()
  for (const t of ["Giá FPT", "/model", "giá VNM", "Giá FPT"]) addHistory(t)
  expect(searchHistory("giá")).toEqual(["Giá FPT", "giá VNM"])
  expect(searchHistory("zzz")).toEqual([])
})
