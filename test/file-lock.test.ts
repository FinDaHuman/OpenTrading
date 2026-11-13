import { execFileSync } from "node:child_process"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises"
import { removeTempDir } from "./helpers/temp"
import { tmpdir } from "node:os"
import path from "node:path"
import { withFileLock } from "../src/core/file-lock"
import * as lockModule from "../src/core/file-lock"
import * as store from "../src/core/store"
import { readWatchlists, watchlistOps } from "../src/core/tools/watchlist/local"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tokenOf = (text: string) => /"token":"([^"]+)"/.exec(text)?.[1]

const windows = process.platform === "win32"
const root = process.getuid?.() === 0
const EVERYONE = "*S-1-1-0"
// pid 2^22+1 is not running anywhere we test.
const deadLock = JSON.stringify({ pid: 4194305, at: Date.now() })
let home = ""

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "ot-lock-"))
})

afterEach(async () => {
  // Windows may still hold a handle a child process or a scanner opened a moment ago.
  await removeTempDir(home, { maxRetries: 10, retryDelay: 100 })
})

test("a holder that keeps refreshing is never taken over, however long it holds (Story 4, scenario 1)", async () => {
  const file = path.join(home, "x.json")
  let entered!: () => void
  const inside = new Promise<void>((r) => (entered = r))
  const a = withFileLock(
    file,
    async () => {
      entered()
      await sleep(2_000)
      return "A"
    },
    { refreshMs: 30 },
  )
  await inside
  await expect(withFileLock(file, async () => "B", { staleMs: 1_000, timeoutMs: 1_400 })).rejects.toThrow("đang giữ khoá")
  expect(await a).toBe("A")
})

test("a holder that stopped refreshing loses the lock and its write is refused before the rename (scenario 3)", async () => {
  const file = path.join(home, "x.json")
  let entered!: () => void
  const inside = new Promise<void>((r) => (entered = r))
  let releaseB!: () => void
  const bMayRelease = new Promise<void>((r) => (releaseB = r))
  let bToken: string | undefined
  const a = withFileLock(
    file,
    async (lock) => {
      entered()
      await sleep(300)
      await store.writeJson(file, "A", false, { beforeCommit: lock.assertHeld })
    },
    { refreshMs: 60_000 },
  )
  await inside
  await sleep(50)
  const b = withFileLock(
    file,
    async () => {
      await store.writeJson(file, "B")
      bToken = tokenOf(await readFile(`${file}.lock`, "utf8"))
      await bMayRelease
    },
    { staleMs: 100 },
  )
  await expect(a).rejects.toThrow("bị tiến trình khác chiếm")
  expect(JSON.parse(await readFile(file, "utf8"))).toBe("B")
  // A's release left B's lock alone (scenario 4).
  expect(bToken).toBeDefined()
  expect(tokenOf(await readFile(`${file}.lock`, "utf8"))).toBe(bToken)
  expect((await readdir(home)).filter((f) => f.endsWith(".tmp"))).toEqual([])
  releaseB()
  await b
  expect(await Bun.file(`${file}.lock`).exists()).toBe(false)
})

test("a lock without a token left by a dead process is still taken over", async () => {
  const file = path.join(home, "x.json")
  // pid 2^22+1 is not running anywhere we test.
  await writeFile(`${file}.lock`, JSON.stringify({ pid: 4194305, at: Date.now() }))
  expect(await withFileLock(file, async () => "ok")).toBe("ok")
  expect(await Bun.file(`${file}.lock`).exists()).toBe(false)
})

test("an empty lock file is one being written, not a dead one", async () => {
  const file = path.join(home, "x.json")
  await writeFile(`${file}.lock`, "")
  await expect(withFileLock(file, async () => "ok", { timeoutMs: 200 })).rejects.toThrow("đang giữ khoá")
})

test("the ownership check runs before every rename attempt, not once before the retries", async () => {
  await watchlistOps.create(home, "qa")
  const file = path.join(home, "watchlists.json")
  const before = await readFile(file, "utf8")
  const rename = spyOn(store.jsonFiles, "rename").mockImplementationOnce(async () => {
    // B takes the lock over while A waits to retry a rename Windows refused.
    await writeFile(`${file}.lock`, JSON.stringify({ pid: process.pid, at: Date.now(), token: "b7" }))
    throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })
  })
  try {
    await expect(watchlistOps.add(home, "qa", ["FPT"])).rejects.toThrow("bị tiến trình khác chiếm")
    expect(rename).toHaveBeenCalledTimes(1)
  } finally {
    rename.mockRestore()
  }
  expect(await readFile(file, "utf8")).toBe(before)
  expect((await readWatchlists(home)).QA!.symbols).toEqual([])
  expect((await readdir(home)).filter((f) => f.endsWith(".tmp"))).toEqual([])
  expect(tokenOf(await readFile(`${file}.lock`, "utf8"))).toBe("b7")
})

const busy = () => Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })

test("R25: a lock file that cannot be read for a moment (a scanner holds it) is not taken as lost", async () => {
  const file = path.join(home, "x.json")
  const read = spyOn(lockModule.lockFiles, "read")
  try {
    // The check right before the rename fails once: retried, the write goes through.
    read.mockImplementationOnce(async () => {
      throw busy()
    })
    await withFileLock(file, async (lock) => store.writeJson(file, "A", false, { beforeCommit: lock.assertHeld }), { refreshMs: 60_000 })
    expect(JSON.parse(await readFile(file, "utf8"))).toBe("A")
    expect(await Bun.file(`${file}.lock`).exists()).toBe(false)
    // The read on release fails once: still released, not left for others to wait on.
    read.mockImplementationOnce(async () => {
      throw busy()
    })
    await withFileLock(file, async () => {}, { refreshMs: 60_000 })
    expect(await Bun.file(`${file}.lock`).exists()).toBe(false)
    // A refresh tick that cannot read skips that tick; the lock is still held afterwards.
    read.mockImplementationOnce(async () => {
      throw busy()
    })
    await withFileLock(
      file,
      async (lock) => {
        await sleep(150)
        await lock.assertHeld()
      },
      { refreshMs: 30 },
    )
  } finally {
    read.mockRestore()
  }
})

test("R26: a lock whose content could not be written is removed, not left empty", async () => {
  const file = path.join(home, "x.json")
  const write = spyOn(lockModule.lockFiles, "write").mockImplementationOnce(async () => {
    throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" })
  })
  try {
    await expect(withFileLock(file, async () => "ok")).rejects.toThrow("no space left")
  } finally {
    write.mockRestore()
  }
  expect(await Bun.file(`${file}.lock`).exists()).toBe(false)
  expect(await withFileLock(file, async () => "ok", { timeoutMs: 300 })).toBe("ok")
})

test("review 2 #6: an owner that refreshes between the staleness check and the removal keeps its lock", async () => {
  const file = path.join(home, "x.json")
  const lock = `${file}.lock`
  // A live owner (our parent process), late: its lock looks a minute old.
  await writeFile(lock, JSON.stringify({ pid: process.ppid, at: Date.now(), token: "owner" }))
  const old = new Date(Date.now() - 60_000)
  await utimes(lock, old, old)
  const realRead = lockModule.lockFiles.read
  // The owner's refresh lands right after the contender decided the lock was stale.
  const read = spyOn(lockModule.lockFiles, "read").mockImplementationOnce(async (l: string) => {
    const now = new Date()
    await utimes(l, now, now)
    return realRead(l)
  })
  try {
    await expect(withFileLock(file, async () => "taken", { timeoutMs: 200 })).rejects.toThrow("đang giữ khoá")
  } finally {
    read.mockRestore()
  }
  expect(tokenOf(await readFile(lock, "utf8"))).toBe("owner")
})

test("review 2 #7: the refresh period follows a short staleMs, so a live holder never looks stale", async () => {
  const file = path.join(home, "x.json")
  let entered!: () => void
  const inside = new Promise<void>((r) => (entered = r))
  // No refreshMs given: the holder must refresh well within its own staleMs.
  const a = withFileLock(
    file,
    async () => {
      entered()
      await sleep(2_000)
      return "A"
    },
    { staleMs: 1_000 },
  )
  await inside
  await expect(withFileLock(file, async () => "B", { staleMs: 1_000, timeoutMs: 1_400 })).rejects.toThrow("đang giữ khoá")
  expect(await a).toBe("A")
})

// Windows-only behaviour since main's df31792; off Windows the permission error is real, covered by the test below.
/** Runs `body` as if on `platform`: the lock reads process.platform when an error arrives. */
async function asPlatform<T>(platform: NodeJS.Platform, body: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, "platform")!
  Object.defineProperty(process, "platform", { ...real, value: platform })
  try {
    return await body()
  } finally {
    Object.defineProperty(process, "platform", real)
  }
}

// Both branches run on every OS (the platform is simulated), so neither is checked by one CI runner only.
for (const platform of ["win32", "linux"] as const) {
  const onWindows = platform === "win32"
  test(`R40 (${platform}): creating the lock fails with EPERM, EACCES, EBUSY: ${onWindows ? "waits (Windows still deletes the old one), not fails" : "the real error at once, no wait"}`, async () => {
    const file = path.join(home, "x.json")
    const create = spyOn(lockModule.lockFiles, "create")
    try {
      await asPlatform(platform, async () => {
        for (const code of ["EPERM", "EACCES", "EBUSY"]) {
          create.mockImplementationOnce(async () => {
            throw Object.assign(new Error(`${code}: operation not permitted`), { code })
          })
          if (onWindows) expect(await withFileLock(file, async () => "ok")).toBe("ok")
          else {
            const started = Date.now()
            await expect(withFileLock(file, async () => "ok", { timeoutMs: 5_000 })).rejects.toThrow(code)
            expect(Date.now() - started).toBeLessThan(1_000)
          }
        }
        if (onWindows) {
          // Still refused after the wait: the real error, not "another process holds the lock".
          create.mockImplementation(async () => {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
          })
          await expect(withFileLock(file, async () => "ok", { timeoutMs: 150 })).rejects.toThrow("permission denied")
        }
      })
    } finally {
      create.mockRestore()
    }
  })
}

test("R47: a rename that keeps failing leaves no temp file behind (auth.json's would hold a key)", async () => {
  const file = path.join(home, "auth.json")
  const rename = spyOn(store.jsonFiles, "rename").mockImplementation(async () => {
    throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" })
  })
  try {
    await expect(store.writeJson(file, { key: "secret" }, true)).rejects.toThrow("cross-device")
  } finally {
    rename.mockRestore()
  }
  expect((await readdir(home)).filter((f) => f.endsWith(".tmp"))).toEqual([])
})

const contender = path.join(import.meta.dir, "fixtures", "scripts", "lock-contender.ts")

function spawnContender(file: string, holdMs: number, staleMs: number, refreshMs: number, log: string) {
  return Bun.spawn([process.execPath, contender, file, String(holdMs), String(staleMs), String(refreshMs), log], { stdout: "pipe", stderr: "pipe" })
}

async function waitFor(check: () => Promise<boolean>, ms = 15_000) {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await sleep(20)
  }
}

const logText = (log: string) => readFile(log, "utf8").catch(() => "")

// staleMs well above any stall a loaded CI runner may cause (antivirus on a new bun.exe), still below the hold.
test("TN3: three processes, the first holding past staleMs while refreshing; no two are ever inside at once (TC-005)", async () => {
  const file = path.join(home, "x.json")
  const log = path.join(home, "log.txt")
  const a = spawnContender(file, 4_000, 1_500, 50, log)
  await waitFor(async () => (await logText(log)).includes("enter"))
  const others = [spawnContender(file, 100, 1_500, 50, log), spawnContender(file, 100, 1_500, 50, log)]
  const procs = [a, ...others]
  const codes = await Promise.all(procs.map((p) => p.exited))
  const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()))
  expect(errors.join("")).toBe("")
  expect(codes).toEqual([0, 0, 0])
  const spans = new Map<string, { enter?: number; exit?: number }>()
  for (const line of (await logText(log)).trim().split("\n")) {
    const [kind, pid, ms] = line.split(" ") as ["enter" | "exit", string, string]
    spans.set(pid, { ...spans.get(pid), [kind]: Number(ms) })
  }
  const sorted = [...spans.values()].sort((x, y) => x.enter! - y.enter!)
  expect(sorted).toHaveLength(3)
  for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.enter!).toBeGreaterThanOrEqual(sorted[i - 1]!.exit!)
}, 60_000)

test("a holder killed mid-hold leaves a lock the next process takes over within its wait (scenario 2)", async () => {
  const file = path.join(home, "x.json")
  const log = path.join(home, "log.txt")
  const a = spawnContender(file, 30_000, 60_000, 50, log)
  await waitFor(async () => (await logText(log)).includes("enter"))
  a.kill()
  await a.exited
  const b = spawnContender(file, 10, 60_000, 50, log)
  expect(await b.exited).toBe(0)
  expect((await logText(log)).match(/enter/g)).toHaveLength(2)
}, 60_000)

/** Runs `body` with nothing in `dir` creatable or deletable, and restores it afterwards. */
async function readOnly<T>(dir: string, body: () => Promise<T>) {
  if (windows) execFileSync("icacls", [dir, "/deny", `${EVERYONE}:(WD,AD,DC)`], { stdio: "ignore" })
  else await chmod(dir, 0o555)
  try {
    return await body()
  } finally {
    if (windows) execFileSync("icacls", [dir, "/remove:d", EVERYONE], { stdio: "ignore" })
    else await chmod(dir, 0o755)
  }
}

/** Marks `file` for deletion through a handle that stays open: Windows keeps it, delete-pending, until `close()`. */
async function deletePending(file: string) {
  const { dlopen, FFIType, ptr } = await import("bun:ffi")
  const { symbols } = dlopen("kernel32.dll", {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
    SetFileInformationByHandle: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  })
  const DELETE = 0x00010000
  const SHARE_ALL = 7
  const OPEN_EXISTING = 3
  const FILE_DISPOSITION_INFO = 4
  const handle = symbols.CreateFileW(ptr(Buffer.from(`${file}\0`, "utf16le")), DELETE, SHARE_ALL, null, OPEN_EXISTING, 0, null)
  expect(symbols.SetFileInformationByHandle(handle, FILE_DISPOSITION_INFO, ptr(new Uint8Array([1])), 1)).toBe(1)
  let open = true
  return {
    close() {
      if (open) symbols.CloseHandle(handle)
      open = false
    },
  }
}

test.skipIf(!windows)("a lock file still being deleted is waited for, not an error", async () => {
  const file = path.join(home, "x.json")
  await writeFile(`${file}.lock`, "")
  const pending = await deletePending(`${file}.lock`)
  const released = setTimeout(pending.close, 150)
  try {
    expect(await withFileLock(file, async () => "ok", { timeoutMs: 5_000 })).toBe("ok")
  } finally {
    clearTimeout(released)
    pending.close()
  }
})

test.skipIf(!windows)("a directory the user cannot write to fails at the deadline with the real error", async () => {
  const dir = path.join(home, "denied")
  await mkdir(dir)
  const started = Date.now()
  const error = await readOnly(dir, () => withFileLock(path.join(dir, "x.json"), async () => "ok", { timeoutMs: 300 }).catch((e) => e))
  expect(error.code).toBe("EPERM")
  expect(error.message).not.toContain("đang giữ khoá")
  expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  expect(Date.now() - started).toBeLessThan(5_000)
})

test.skipIf(windows || root)("off Windows a permission error is real at once, with no wait", async () => {
  const dir = path.join(home, "denied")
  await mkdir(dir)
  const started = Date.now()
  const error = await readOnly(dir, () => withFileLock(path.join(dir, "x.json"), async () => "ok", { timeoutMs: 5_000 }).catch((e) => e))
  expect(error.code).toBe("EACCES")
  expect(Date.now() - started).toBeLessThan(2_000)
})

test.skipIf(root)("a dead process's lock that cannot be removed ends at the deadline, not in a spin", async () => {
  const dir = path.join(home, "denied")
  await mkdir(dir)
  const file = path.join(dir, "x.json")
  await writeFile(`${file}.lock`, deadLock)
  if (windows) execFileSync("icacls", [`${file}.lock`, "/deny", `${EVERYONE}:(DE)`], { stdio: "ignore" })
  try {
    const error = await readOnly(dir, () => withFileLock(file, async () => "ok", { timeoutMs: 300 }).catch((e) => e))
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain("đang giữ khoá")
  } finally {
    if (windows) execFileSync("icacls", [`${file}.lock`, "/remove:d", EVERYONE], { stdio: "ignore" })
  }
}, 15_000)
