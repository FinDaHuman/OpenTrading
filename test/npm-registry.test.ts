import { expect, test } from "bun:test"
import { missingFromNpm, trustedPublisher, waitForNpm, type Fetch } from "../scripts/npm-registry"

const url = (name: string) => `https://registry.npmjs.org/${name}`
const tarball = (name: string) => `${url(name)}/-/${name}-0.5.0.tgz`
const doc = (name: string, versions: string[], latest = versions.at(-1)) =>
  Response.json({ "dist-tags": { latest }, versions: Object.fromEntries(versions.map((v) => [v, { dist: { tarball: tarball(name) } }])) })
const ok = () => new Response("")
const gone = () => new Response("", { status: 404 })

type Answers = Record<string, Array<() => Response>>

/** Answers per URL: a list is consumed one per call, the last one repeating; no list is a 404. */
function registry(answers: Answers) {
  const calls: string[] = []
  const fetchFn: Fetch = async (asked) => {
    calls.push(asked)
    const list = answers[asked]
    if (!list) return gone()
    return (list.length > 1 ? list.shift()! : list[0]!)()
  }
  return { calls, fetch: fetchFn }
}

test("a version is there only when listed, its tarball downloads and, if asked, latest points at it", async () => {
  const check = (answers: Answers, latest?: boolean) => missingFromNpm("a", "0.5.0", { fetch: registry(answers).fetch, latest })
  expect(await check({})).toBe("package HTTP 404")
  expect(await check({ [url("a")]: [() => doc("a", ["0.4.0"])] })).toBe("version not listed")
  expect(await check({ [url("a")]: [() => doc("a", ["0.5.0"])], [tarball("a")]: [gone] })).toBe("tarball HTTP 404")
  expect(await check({ [url("a")]: [() => doc("a", ["0.5.0"], "0.4.0")], [tarball("a")]: [ok] }, true)).toBe("latest is 0.4.0")
  expect(await check({ [url("a")]: [() => doc("a", ["0.5.0"], "0.4.0")], [tarball("a")]: [ok] })).toBeUndefined()
  expect(await check({ [url("a")]: [() => new Response("<html>")] })).toBeString()
})

test("a scoped name is escaped as npm does", async () => {
  const npm = registry({})
  await missingFromNpm("@x/y", "1.0.0", { fetch: npm.fetch })
  expect(npm.calls).toEqual([url("@x%2fy")])
})

test("waits for the late packages only, then returns", async () => {
  const npm = registry({
    [url("a")]: [() => doc("a", ["0.5.0"])],
    [tarball("a")]: [ok],
    [url("b")]: [() => doc("b", ["0.4.0"]), () => doc("b", ["0.5.0"])],
    [tarball("b")]: [gone, ok],
  })
  let sleeps = 0
  await waitForNpm(["a", "b"], "0.5.0", { fetch: npm.fetch, sleep: async () => sleeps++, log: () => {} })
  expect(sleeps).toBe(2)
  expect(npm.calls.filter((c) => c === url("a"))).toHaveLength(1)
  expect(npm.calls.filter((c) => c === url("b"))).toHaveLength(3)
})

test("gives up after the timeout and names what is missing", async () => {
  let clock = 0
  const npm = registry({ [url("a")]: [() => doc("a", ["0.5.0"])], [tarball("a")]: [ok], [url("b")]: [() => doc("b", ["0.4.0"])] })
  const wait = waitForNpm(["a", "b"], "0.5.0", {
    fetch: npm.fetch,
    now: () => clock,
    sleep: async (ms) => (clock += ms),
    timeoutMs: 60_000,
    everyMs: 15_000,
    log: () => {},
  })
  await expect(wait).rejects.toThrow("npm does not serve 0.5.0 after 60s: b (version not listed)")
})

test("tells a trusted publisher from a token", async () => {
  const user = (u: object) => registry({ [`${url("a")}/0.5.0`]: [() => Response.json({ _npmUser: u })] }).fetch
  expect(await trustedPublisher("a", "0.5.0", user({ name: "GitHub Actions", trustedPublisher: { id: "github" } }))).toBe(true)
  expect(await trustedPublisher("a", "0.5.0", user({ name: "someone" }))).toBe(false)
  expect(await trustedPublisher("a", "0.5.0", registry({}).fetch)).toBeUndefined()
})
