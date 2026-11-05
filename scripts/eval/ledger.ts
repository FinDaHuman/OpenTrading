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

/**
 * The cap is on one model's quota. Other models a run calls (a side model on another provider)
 * are booked under their own key and do not spend it.
 */
export class RequestLedger {
  private pending = new Map<string, number>()

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
    return this.spentBefore + (this.pending.get(this.key) ?? 0)
  }

  get exhausted() {
    return this.spent >= this.cap
  }

  note(key: string) {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
  }

  /** Written per question rather than per request: a request must not wait on a file lock. */
  async flush() {
    const counts = [...this.pending]
    if (counts.length === 0) return
    this.pending.clear()
    const day = await updateJson<Day>(this.file, {}, (current) => {
      const next = { ...current }
      for (const [key, count] of counts) next[key] = (next[key] ?? 0) + count
      return next
    })
    this.spentBefore = day[this.key] ?? 0
  }
}
