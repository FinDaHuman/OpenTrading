import { execFileSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { withFileLock } from "../src/core/file-lock"

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
  await rm(home, { recursive: true, force: true })
})

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
