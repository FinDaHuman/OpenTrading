import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

/** #349: pages of the first Python design linked to source files that are no longer in the repository. */
const HANDBOOK = path.join(import.meta.dir, "..", "handbook")
const pages = readdirSync(HANDBOOK, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".md"))

test("every relative link in the handbook points at a file that exists", () => {
  expect(pages.length).toBeGreaterThan(10)
  const dead: string[] = []
  let checked = 0
  for (const page of pages) {
    const text = readFileSync(path.join(HANDBOOK, page), "utf8").replace(/```[\s\S]*?```/g, "")
    for (const [, link] of text.matchAll(/\]\(([^)\s#]+)/g)) {
      if (/^[a-z]+:/i.test(link!)) continue
      checked++
      if (!existsSync(path.join(HANDBOOK, path.dirname(page), link!))) dead.push(`${page} -> ${link}`)
    }
  }
  expect(checked).toBeGreaterThan(10)
  expect(dead).toEqual([])
})
