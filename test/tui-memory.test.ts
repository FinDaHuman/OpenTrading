import { expect, test } from "bun:test"
import path from "node:path"

/*
 * The TUI keeps global state (store, current session) that would leak into test/tui.test.tsx if both ran in one
 * process, so the memory TUI scenario runs in its own `bun test` process. The scenario file is named without
 * `.test` so the main run does not pick it up a second time.
 */
test("TUI with the SQLite memory provider: end-to-end scenario passes in its own process", () => {
  const scenario = path.resolve(import.meta.dir, "tui-memory.scenario.tsx")
  const p = Bun.spawnSync([process.execPath, "test", scenario], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  })
  const out = p.stdout.toString() + p.stderr.toString()
  if (p.exitCode !== 0) console.error(out)
  expect(p.exitCode).toBe(0)
  expect(out).toMatch(/\b8 pass\b/)
  expect(out).toMatch(/\b0 fail\b/)
}, 130_000)
