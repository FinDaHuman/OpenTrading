/**
 * What the npm registry serves to users, as opposed to what `npm publish` accepted: a version can
 * take minutes to appear after a successful publish (0.5.0: 2 to 6 minutes, and two platform
 * packages became visible after the main one). No dependencies: the release job has no install.
 */

const REGISTRY = "https://registry.npmjs.org"
const escaped = (name: string) => name.replace("/", "%2f")

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface WaitOptions {
  /** Also require `dist-tags.latest` to be the version (what `npm i <name>` installs). */
  latest?: boolean
  timeoutMs?: number
  everyMs?: number
  fetch?: Fetch
  sleep?: (ms: number) => Promise<unknown>
  now?: () => number
  log?: (line: string) => void
}

/** Why `npm i <name>@<version>` would not work right now, or undefined when it would. */
export async function missingFromNpm(name: string, version: string, opts: Pick<WaitOptions, "latest" | "fetch"> = {}): Promise<string | undefined> {
  const fetchFn = opts.fetch ?? fetch
  try {
    // The document npm itself reads to resolve a version.
    const res = await fetchFn(`${REGISTRY}/${escaped(name)}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return `package HTTP ${res.status}`
    const doc = (await res.json()) as { "dist-tags"?: Record<string, string>; versions?: Record<string, { dist?: { tarball?: string } }> }
    const tarball = doc.versions?.[version]?.dist?.tarball
    if (!tarball) return "version not listed"
    if (opts.latest && doc["dist-tags"]?.latest !== version) return `latest is ${doc["dist-tags"]?.latest}`
    const file = await fetchFn(tarball, { method: "HEAD", signal: AbortSignal.timeout(20_000) })
    return file.ok ? undefined : `tarball HTTP ${file.status}`
  } catch (error) {
    // No network, a timeout, a broken body: not ready, ask again.
    return error instanceof Error ? error.message : String(error)
  }
}

/** Wait until npm serves `version` of every package; throws with what is missing after the timeout. */
export async function waitForNpm(names: string[], version: string, opts: WaitOptions = {}): Promise<void> {
  const { timeoutMs = 20 * 60_000, everyMs = 15_000 } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))
  const now = opts.now ?? Date.now
  const log = opts.log ?? console.log
  const start = now()
  let waiting = names
  for (;;) {
    const checked = await Promise.all(waiting.map(async (name) => ({ name, missing: await missingFromNpm(name, version, opts) })))
    const still = checked.filter((c) => c.missing !== undefined)
    const seconds = Math.round((now() - start) / 1000)
    for (const { name } of checked.filter((c) => c.missing === undefined)) log(`  on npm after ${seconds}s: ${name}@${version}`)
    if (still.length === 0) return
    if (now() - start >= timeoutMs) {
      throw new Error(`npm does not serve ${version} after ${seconds}s: ${still.map((c) => `${c.name} (${c.missing})`).join(", ")}`)
    }
    waiting = still.map((c) => c.name)
    await sleep(everyMs)
  }
}

/** Whether a published version came from a trusted publisher (OIDC) rather than a token. */
export async function trustedPublisher(name: string, version: string, fetchFn: Fetch = fetch): Promise<boolean | undefined> {
  try {
    const res = await fetchFn(`${REGISTRY}/${escaped(name)}/${version}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return undefined
    const doc = (await res.json()) as { _npmUser?: { trustedPublisher?: unknown } }
    return doc._npmUser?.trustedPublisher !== undefined
  } catch {
    return undefined
  }
}
