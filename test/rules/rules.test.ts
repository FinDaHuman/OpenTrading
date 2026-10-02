import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadRules, parseRule } from "../../src/core/rules/load"
import { manualRuleNames, matchRules } from "../../src/core/rules/match"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function dir(files: Record<string, string>) {
  const d = await mkdtemp(path.join(os.tmpdir(), "opentrading-rules-"))
  dirs.push(d)
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(d, name), text, "utf8")
  return d
}

describe("parseRule", () => {
  test("reads frontmatter with JSON arrays and booleans; tolerates BOM and CRLF", () => {
    const r = parseRule(
      '﻿---\r\nname: ngan-hang\r\nsectors: ["banking"]\r\ntickers: ["VCB"]\r\n---\r\nXem NPL.\r\n',
      "repo",
    )
    expect(r).toMatchObject({
      name: "ngan-hang",
      sectors: ["banking"],
      tickers: ["VCB"],
      mode: "scoped",
      body: "Xem NPL.",
    })
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("modes: always, scoped, agent, manual", () => {
    const mode = (fm: string) => parseRule(`---\nname: x\n${fm}\n---\nbody`, "repo").mode
    expect(mode("alwaysApply: true")).toBe("always")
    expect(mode('sectors: ["steel"]')).toBe("scoped")
    expect(mode("description: khi nào dùng")).toBe("agent")
    expect(mode("")).toBe("manual")
  })

  test("invalid rules throw with a reason", () => {
    expect(() => parseRule("no frontmatter", "repo")).toThrow()
    expect(() => parseRule("---\nname: Bad Name\n---\nb", "repo")).toThrow()
    expect(() => parseRule("---\nname: x\n---\n", "repo")).toThrow()
    expect(() => parseRule("---\nname: x\nunknown: 1\n---\nb", "repo")).toThrow()
  })
})

describe("loadRules", () => {
  test("bundled rules load without errors", () => {
    const set = loadRules()
    expect(set.errors).toEqual([])
    expect(set.rules.map((r) => r.name)).toEqual(["ngan-hang", "nguon-so-lieu", "phai-sinh"])
  })

  test("a user rule replaces the repo rule of the same name; broken files are reported", async () => {
    const repo = await dir({ "a.md": "---\nname: a\nalwaysApply: true\n---\nrepo A" })
    const user = await dir({
      "a.md": "---\nname: a\nalwaysApply: true\n---\nuser A",
      "broken.md": "not a rule",
      "mismatch.md": "---\nname: other\n---\nb",
    })
    const set = loadRules({ repo, user })
    expect(set.rules).toMatchObject([{ name: "a", body: "user A", source: "user" }])
    expect(set.errors.map((e) => path.basename(e.file)).sort()).toEqual(["broken.md", "mismatch.md"])
  })
})

describe("matchRules", () => {
  const rules = loadRules().rules

  test("banking question loads ngan-hang; HPG does not", () => {
    expect(matchRules(rules, { tickers: ["VCB"], sectors: ["banking"] }).scoped.map((r) => r.name)).toEqual([
      "ngan-hang",
    ])
    expect(matchRules(rules, { tickers: ["HPG"], sectors: ["steel"] }).scoped).toEqual([])
  })

  test("always rules always; agent rules only in the catalog unless asked with @rule:", () => {
    const none = matchRules(rules, { tickers: [], sectors: [] })
    expect(none.always.map((r) => r.name)).toEqual(["nguon-so-lieu"])
    expect(none.catalog.map((r) => r.name)).toEqual(["phai-sinh"])
    expect(none.scoped).toEqual([])
    const asked = matchRules(rules, { tickers: [], sectors: [] }, manualRuleNames("so sánh @rule:phai-sinh"))
    expect(asked.scoped.map((r) => r.name)).toEqual(["phai-sinh"])
  })

  test("@rule: needs a boundary", () => {
    expect(manualRuleNames("email@rule:x và @rule:a @rule:a")).toEqual(["a"])
  })
})
