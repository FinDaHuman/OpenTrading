import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { localWatchlistTools } from "../src/core/tools/watchlist/local"

/**
 * 15/11 real-key round (MyToDoList 45i-1): `create` with `symbols` made an empty list, and the model then said
 * the list held FPT and HPG. A list created with symbols holds them, in the same write.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-watch-create-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test("create with symbols holds them at once; invalid ones are named; create alone stays empty", async () => {
  const [tool] = localWatchlistTools(root)
  const run = (input: Record<string, unknown>) => tool!.execute(input as never, {} as never) as Promise<string>
  const made = await run({ action: "create", name: "cong nghe", symbols: ["fpt", "HPG", "hpg", "??"] })
  expect(made).toContain("FPT, HPG")
  expect(made).toContain("??")
  expect(await run({ action: "get", name: "cong nghe" })).toContain("(2 tickers")
  await run({ action: "create", name: "trong" })
  expect(await run({ action: "get", name: "trong" })).toContain("(empty)")
  // A name taken stays an error, and nothing is added to the existing list.
  await expect(run({ action: "create", name: "cong nghe", symbols: ["VCB"] })).rejects.toThrow("already exists")
  expect(await run({ action: "get", name: "cong nghe" })).not.toContain("VCB")
})
