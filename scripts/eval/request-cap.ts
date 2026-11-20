import { guardModelRequests, onModelRequest } from "../../src/core/requests"
import type { RequestLedger } from "./ledger"

/**
 * A hard cap on the model requests one eval run sends, counted at the provider's fetch
 * (requests.ts): retries, side calls, subagents, desk agents and the judge all count, which
 * step events do not (#350). A request past the cap, or past the day's ledger cap, is refused
 * before it leaves the process.
 */
export function requestCap(cap: number, ledger?: RequestLedger) {
  let sent = 0
  const stopCount = onModelRequest((request) => {
    sent++
    ledger?.note(`${request.provider}/${request.model}`)
  })
  const stopGuard = guardModelRequests(() => {
    if (sent >= cap) return `Eval request cap reached (${sent}/${cap}); the request was not sent.`
    if (ledger?.exhausted) return `Daily request cap reached (${ledger.spent}/${ledger.cap}); the request was not sent.`
    return undefined
  })
  return {
    get sent() {
      return sent
    },
    get capped() {
      return sent >= cap || Boolean(ledger?.exhausted)
    },
    /** Runs `fn` and adds the requests it really sent to its result, replacing any estimate. */
    async measure<T extends { requests: number }>(fn: () => Promise<T>): Promise<T> {
      const before = sent
      try {
        const result = await fn()
        return { ...result, requests: sent - before }
      } finally {
        await ledger?.flush()
      }
    },
    stop() {
      stopCount()
      stopGuard()
    },
  }
}
