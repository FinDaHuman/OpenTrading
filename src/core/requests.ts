/**
 * Every HTTP request sent to a model, seen at the provider's fetch: retries and side calls
 * (compaction, titles, the web side model, the auto-mode reviewer) count, which `step` events
 * do not. Usage events report tokens; this is what a daily request quota is spent on.
 */
export interface ModelRequest {
  provider: string
  model: string
}

type Listener = (request: ModelRequest) => void

const listeners = new Set<Listener>()

export function onModelRequest(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Says why a request must not be sent, or undefined. */
type Guard = (request: ModelRequest) => string | undefined

const guards = new Set<Guard>()

/**
 * Refuse model requests before they leave the process (a caller's request budget). A refused
 * request is not sent and not counted; the provider SDK sees a rejected fetch, which the retry
 * wrapper does not retry (no network or rate-limit word in the message).
 */
export function guardModelRequests(guard: Guard) {
  guards.add(guard)
  return () => guards.delete(guard)
}

/** The fetch a provider SDK sends through. `globalThis.fetch` is read per call, as the SDKs do. */
export function countedFetch(provider: string, model: string): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    for (const guard of guards) {
      const why = guard({ provider, model })
      if (why) return Promise.reject(Object.assign(new Error(why), { name: "RequestBudgetExceeded" }))
    }
    for (const listener of listeners) listener({ provider, model })
    return globalThis.fetch(input, init)
  }) as typeof globalThis.fetch
}
