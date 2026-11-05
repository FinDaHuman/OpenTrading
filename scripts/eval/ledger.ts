import { readFile } from "node:fs/promises"
import path from "node:path"
import { updateJson } from "../../src/core/store"

/** Model requests spent per day, by `provider/model`. Runs add up, so a cap holds across them. */
type Day = Record<string, number>

const today = (now: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The ledger of `now`'s local day. Kept in the real home: a run's own home is deleted. */
export const ledgerFile = (home: string, now = new Date()) => path.join(home, "usage", `${today(now)}.json`)

/** What a day's ledger holds so far: a preview reads it without opening a run. */
export async function spentToday(file: string, key: string) {
  const text = await readFile(file, "utf8").catch(() => "{}")
  return (JSON.parse(text) as Day)[key] ?? 0
}

export class RequestLedger {
  private pending = 0

  private constructor(
    private file: string,
    private key: string,
    private spentBefore: number,
    readonly cap: number,
  ) {}

  static async open(file: string, key: string, cap: number) {
    return new RequestLedger(file, key, await spentToday(file, key), cap)
  }

  get spent() {
    return this.spentBefore + this.pending
  }

  get exhausted() {
    return this.spent >= this.cap
  }

  note() {
    this.pending++
  }

  /** Written per question rather than per request: a request must not wait on a file lock. */
  async flush() {
    const count = this.pending
    if (count === 0) return
    this.pending = 0
    const day = await updateJson<Day>(this.file, {}, (current) => ({ ...current, [this.key]: (current[this.key] ?? 0) + count }))
    this.spentBefore = day[this.key] ?? 0
  }
}
