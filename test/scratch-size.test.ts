import { afterAll, expect, test } from "bun:test"
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Scratchpad } from "../src/core/fs/scratch"
import { clearScratch, formatSize, pruneScratch, removeTree, ScratchMonitor, treeSize, type ScratchUsage } from "../src/core/fs/scratch-size"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-scratch-size-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const DAY = 86_400_000
const linkType = process.platform === "win32" ? "junction" : "dir"
let n = 0
const fresh = (name: string) => {
  const dir = path.join(root, `${name}-${n++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A folder outside the scratchpad with a file that must survive every walk and delete. */
function outsideTarget() {
  const dir = fresh("ngoai")
  writeFileSync(path.join(dir, "quan-trong.txt"), "x".repeat(5000))
  return dir
}

/** Every file, folder and link under `dir` (and itself) gets mtime `at`; links are not entered. */
function age(dir: string, at: number) {
  const walk = (p: string) => {
    const info = lstatSync(p)
    if (info.isSymbolicLink()) return lutimesSync(p, at / 1000, at / 1000)
    if (info.isDirectory()) for (const name of readdirSync(p)) walk(path.join(p, name))
    utimesSync(p, at / 1000, at / 1000)
  }
  walk(dir)
}

function session(pad: Scratchpad, id: string, bytes = 100) {
  const dir = path.join(pad.project, id, "scratchpad")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "a.csv"), "x".repeat(bytes))
  return path.join(pad.project, id)
}

test("formatSize: KB, MB, then GB with a decimal comma", () => {
  expect(formatSize(2048)).toBe("2 KB")
  expect(formatSize(820 * 1024 * 1024)).toBe("820 MB")
  expect(formatSize(1.3 * 1024 ** 3)).toBe("1,3 GB")
})

test("treeSize counts files and the newest mtime, never through a link", async () => {
  const dir = fresh("size")
  writeFileSync(path.join(dir, "a.txt"), "12345")
  mkdirSync(path.join(dir, "con"))
  writeFileSync(path.join(dir, "con", "b.txt"), "123")
  symlinkSync(outsideTarget(), path.join(dir, "lien-ket"), linkType)
  const size = await treeSize(dir)
  expect(size.bytes).toBe(8)
  expect(size.files).toBe(2)
  expect(size.partial).toBe(false)
  expect(size.newest).toBeGreaterThan(Date.now() - DAY)
  expect((await treeSize(dir, 2)).partial).toBe(true)
  expect(await treeSize(path.join(dir, "khong-co"))).toEqual({ bytes: 0, files: 0, newest: 0, partial: false })
})

test("removeTree deletes a link inside as a link: the folder it points at stays", async () => {
  const target = outsideTarget()
  const dir = fresh("xoa")
  mkdirSync(path.join(dir, "con"))
  writeFileSync(path.join(dir, "con", "a.txt"), "x")
  symlinkSync(target, path.join(dir, "con", "ra-ngoai"), linkType)
  await removeTree(dir)
  expect(existsSync(dir)).toBe(false)
  expect(existsSync(path.join(target, "quan-trong.txt"))).toBe(true)
})

test("pruneScratch: sessions untouched for keepDays go (links not followed), recent and skipped ones stay, empty projects go", async () => {
  const tmp = fresh("tmp")
  const now = Date.now()
  const a = new Scratchpad(path.join(root, "du-an-a"), { tmp })
  const b = new Scratchpad(path.join(root, "du-an-b"), { tmp })
  const target = outsideTarget()
  const old = session(a, "cu")
  symlinkSync(target, path.join(old, "scratchpad", "ra-ngoai"), linkType)
  const recent = session(a, "moi")
  const kept = session(a, "giu")
  const lone = session(b, "cu-b")
  for (const dir of [old, kept, lone]) age(dir, now - 40 * DAY)
  age(recent, now - 2 * DAY)
  expect(await pruneScratch(a.base, 30, { now, skip: [kept] })).toBe(2)
  expect(existsSync(old)).toBe(false)
  expect(existsSync(lone)).toBe(false)
  expect(existsSync(b.project)).toBe(false)
  expect(existsSync(recent)).toBe(true)
  expect(existsSync(kept)).toBe(true)
  expect(existsSync(path.join(target, "quan-trong.txt"))).toBe(true)
})

test("/scratch clear: other sessions go unless changed in the last hour; this one only with 'all'", async () => {
  const tmp = fresh("tmp")
  const now = Date.now()
  const pad = new Scratchpad(path.join(root, "du-an-clear"), { tmp })
  pad.attach("hien-tai")
  const mine = session(pad, "hien-tai")
  const other = session(pad, "khac")
  const live = session(pad, "cua-so-khac")
  age(other, now - 3 * 3_600_000)
  expect(await clearScratch(pad, { now })).toEqual({ removed: 1, spared: 1 })
  expect(existsSync(other)).toBe(false)
  expect(existsSync(live)).toBe(true)
  expect(existsSync(mine)).toBe(true)
  expect(await clearScratch(pad, { now, current: true })).toEqual({ removed: 1, spared: 1 })
  expect(existsSync(mine)).toBe(false)
})

test("the size warning: measured when a turn starts (at most every 30 minutes), said once per step", async () => {
  const pad = new Scratchpad(path.join(root, "du-an-canh-bao"), { tmp: fresh("tmp") })
  pad.attach("s")
  let clock = 0
  let bytes = 0
  let walks = 0
  const usage = async (): Promise<ScratchUsage> => {
    walks++
    const size = { bytes, files: 1, newest: 0, partial: false }
    return { project: size, session: size, sessions: 1 }
  }
  const GB = 1024 ** 3
  const watch = new ScratchMonitor(pad, { warnBytes: async () => GB, now: () => clock, usage })
  const turn = async (minutes: number) => {
    clock += minutes * 60_000
    watch.start()
    await watch.settled()
    return watch.takeWarning()
  }
  expect(await turn(0)).toBeUndefined()
  bytes = 1.3 * GB
  expect(await turn(10)).toBeUndefined() // not measured again yet
  expect(walks).toBe(1)
  const first = await turn(25)
  expect(first).toContain("1,3 GB")
  expect(first).toContain(pad.project)
  expect(first).toContain("/scratch clear")
  expect(await turn(31)).toBeUndefined() // same step: said once
  bytes = 2.1 * GB
  expect(await turn(31)).toContain("2,1 GB")
  bytes = 0.2 * GB
  expect(await turn(31)).toBeUndefined()
  bytes = 1.1 * GB
  expect(await turn(31)).toContain("1,1 GB") // fell below, crossed again
  pad.enabled = false
  const before = walks
  expect(await turn(31)).toBeUndefined()
  expect(walks).toBe(before)
})
