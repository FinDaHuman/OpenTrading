import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { testRender, useRenderer } from "@opentui/solid"
import { setRendererCapabilities } from "@opentui/core/testing"
import { renderedFrame } from "./helpers/tui"

// #345: file paths in the transcript are OSC 8 links when the terminal takes them, plain text otherwise.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-file-links-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
const root = path.join(home, "ws")
const extra = path.join(home, "them")
// Two segments: ext4 caps a name at 255 bytes; once encoded the href is still past MAX_LINK_URL_BYTES.
const LONG_DIR = `${"kết".repeat(25)}/${"kết".repeat(25)}`
for (const rel of ["src/x.ts", "báo cáo/kết quả (1).md", "run.ps1", "notes.js", "tool.py", "README.md", `${LONG_DIR}/a.md`]) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), "x")
}
mkdirSync(extra, { recursive: true })
writeFileSync(path.join(extra, "data.csv"), "x")
writeFileSync(path.join(home, "outside.md"), "x")

const { MAX_LINK_URL_BYTES } = await import("@opentui/core")
const { fileHref, linkMarkdown, linkSegments, setLinkRoots } = await import("../src/tui/file-links")
const { markdownStyle } = await import("../src/tui/theme")
const { Transcript } = await import("../src/tui/transcript")
const { setState } = await import("../src/tui/state")

setLinkRoots(() => [root, extra])
const href = (rel: string, base = root) => pathToFileURL(path.join(base, rel)).href.replace(/\(/g, "%28").replace(/\)/g, "%29")

let setup: Awaited<ReturnType<typeof testRender>> | undefined
afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  setState({ lines: [] })
})
afterAll(async () => {
  setLinkRoots(() => [])
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe("which paths link", () => {
  test("an existing file under a root (relative or absolute, /add-dir roots too)", () => {
    expect(fileHref("src/x.ts")).toBe(href("src/x.ts"))
    expect(fileHref(path.join(root, "src", "x.ts"))).toBe(href("src/x.ts"))
    expect(fileHref("data.csv")).toBe(href("data.csv", extra))
    expect(fileHref("báo cáo/kết quả (1).md")).toBe(href("báo cáo/kết quả (1).md"))
    // Brackets and spaces are encoded: a markdown destination never ends inside the URL.
    expect(fileHref("báo cáo/kết quả (1).md")).not.toMatch(/[ ()]/)
  })

  test("never: missing, a folder, outside the roots, runnable, UNC, a URL, or longer than the renderer keeps", () => {
    for (const token of ["src/y.ts", "src", "../outside.md", path.join(home, "outside.md"), "run.ps1", "notes.js", "tool.py", "src/x.ts::$DATA", "README.md:Zone.Identifier", "\\\\server\\share\\a.md", "https://x.vn/src/x.ts", `${LONG_DIR}/a.md`])
      expect(fileHref(token)).toBeUndefined()
    // The long one is refused for its href's length, not because it is missing.
    expect(Buffer.byteLength(href(`${LONG_DIR}/a.md`))).toBeGreaterThan(MAX_LINK_URL_BYTES)
  })

  test("in text: tickers, T+2.5 and a URL's tail stay plain; a :line suffix stays out of the link", () => {
    expect(linkSegments("HPG tăng 2.5% ở T+2.5, xem https://x.vn/src/x.ts")).toEqual([{ text: "HPG tăng 2.5% ở T+2.5, xem https://x.vn/src/x.ts" }])
    expect(linkSegments("Đã sửa src/x.ts:12 và README.md.")).toEqual([
      { text: "Đã sửa " },
      { text: "src/x.ts", href: href("src/x.ts") },
      { text: ":12 và " },
      { text: "README.md", href: href("README.md") },
      { text: "." },
    ])
  })
})

describe("markdown rewrite", () => {
  test("code spans and prose paths link; code blocks, links, URLs and emphasis-looking paths do not", () => {
    const md = [
      "# Báo cáo src/x.ts",
      "Xem `src/x.ts` và README.md, không phải `HPG` hay `src/y.ts`.",
      "",
      "```",
      "src/x.ts",
      "```",
      "",
      "    src/x.ts",
      "",
      "[đã có](README.md) <https://x.vn/a.md> https://x.vn/README.md",
      "| Tệp | Ghi chú |",
      "| --- | --- |",
      "| `báo cáo/kết quả (1).md` | ok |",
    ].join("\n")
    expect(linkMarkdown(md).split("\n")).toEqual([
      `# Báo cáo [src/x.ts](${href("src/x.ts")})`,
      `Xem [\`src/x.ts\`](${href("src/x.ts")}) và [README.md](${href("README.md")}), không phải \`HPG\` hay \`src/y.ts\`.`,
      "",
      "```",
      "src/x.ts",
      "```",
      "",
      "    src/x.ts",
      "",
      "[đã có](README.md) <https://x.vn/a.md> https://x.vn/README.md",
      "| Tệp | Ghi chú |",
      "| --- | --- |",
      `| [\`báo cáo/kết quả (1).md\`](${href("báo cáo/kết quả (1).md")}) | ok |`,
    ])
  })

  test("nothing to link: the text comes back unchanged", () => {
    const md = "HPG T+2.5, `run.ps1`, **đậm**\n\n- một\n- hai"
    expect(linkMarkdown(md)).toBe(md)
  })
})

/** Renders the markdown as the transcript does, with hyperlinks on or off. */
async function renderMarkdown(content: string, hyperlinks: boolean) {
  function View() {
    const scene = useRenderer().nativeScene
    return <markdown conceal syntaxStyle={markdownStyle(scene)} internalBlockMode="top-level" tableOptions={{ style: "grid" }} content={content} />
  }
  setup = await testRender(() => <View />, { width: 100, height: 30 })
  setRendererCapabilities(setup.renderer, { hyperlinks })
  const frame = await renderedFrame(setup, (f) => f.includes("Xem"))
  return frame
}

/** Every link under the frame's cells, as "row:text→url" runs. */
function linksIn(frame: string) {
  const r = setup!.renderer
  const found = new Set<string>()
  frame.split("\n").forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const url = r.getLinkAt(x, y)
      if (url) found.add(url)
    }
  })
  return [...found]
}

describe("render", () => {
  const MD = "# Báo cáo src/x.ts\n\nXem `src/x.ts` và README.md, **đậm** [có sẵn](https://x.vn/b.md).\n\n    src/x.ts\n\n- `src/x.ts` trong danh sách\n  - lồng\n\n        ```\n        cat src/x.ts\n        ```\n\n| Tệp | Cỡ |\n| --- | --- |\n| `báo cáo/kết quả (1).md` | 1 |\n\n```\nsrc/x.ts\n```\n\nHPG T+2.5 https://x.vn/a.md"

  test("with links on, the rewritten answer shows the same characters and the paths are links", async () => {
    const plain = await renderMarkdown(MD, true)
    setup!.renderer.destroy()
    const linked = await renderMarkdown(linkMarkdown(MD), true)
    expect(linked).toBe(plain)
    expect(linksIn(linked).sort()).toEqual([href("README.md"), href("báo cáo/kết quả (1).md"), href("src/x.ts"), "https://x.vn/a.md", "https://x.vn/b.md"].sort())
  })

  test("the transcript: no link while the terminal has not said it takes them; links once it does", async () => {
    setState({
      lines: [
        { kind: "tool", callId: "c1", name: "write_file", label: "Ghi src/x.ts", status: "ok", output: "Đã ghi 1 dòng, xem README.md" },
        { kind: "assistant", text: "Đã ghi `src/x.ts`. HPG T+2.5.", done: true },
      ],
    })
    setup = await testRender(() => <Transcript />, { width: 100, height: 20 })
    const before = await renderedFrame(setup, "HPG T+2.5")
    expect(linksIn(before)).toEqual([])
    // As the real terminal answers after start: the capability event turns links on.
    const caps = setRendererCapabilities(setup.renderer, { hyperlinks: true })
    setup.renderer.emit("capabilities", caps)
    // Until the answer's markdown is built again with its link (its highlight pass is asynchronous).
    const answerLinked = (f: string) => {
      const rows = f.split("\n")
      const y = rows.findIndex((r) => r.includes("Đã ghi src/x.ts"))
      return y >= 0 && setup!.renderer.getLinkAt(rows[y]!.indexOf("src/x.ts"), y) !== null
    }
    let after = await renderedFrame(setup, "HPG T+2.5")
    for (let i = 0; i < 100 && !answerLinked(after); i++) after = await renderedFrame(setup, "HPG T+2.5")
    expect(after).toBe(before)
    expect(linksIn(after).sort()).toEqual([href("README.md"), href("src/x.ts")].sort())
    // The label and the answer both link to src/x.ts.
    const rows = after.split("\n")
    const labelRow = rows.findIndex((r) => r.includes("Ghi src/x.ts"))
    const answerRow = rows.findIndex((r) => r.includes("Đã ghi src/x.ts"))
    expect(setup.renderer.getLinkAt(rows[labelRow]!.indexOf("src/x.ts"), labelRow)).toBe(href("src/x.ts"))
    expect(setup.renderer.getLinkAt(rows[answerRow]!.indexOf("src/x.ts"), answerRow)).toBe(href("src/x.ts"))
    expect(setup.renderer.getLinkAt(rows[answerRow]!.indexOf("HPG"), answerRow)).toBeNull()
  })

  test("OPENTRADING_HYPERLINKS=0 keeps every path plain", async () => {
    process.env.OPENTRADING_HYPERLINKS = "0"
    try {
      setState({ lines: [{ kind: "assistant", text: "Đã ghi `src/x.ts`.", done: true }] })
      setup = await testRender(() => <Transcript />, { width: 100, height: 10 })
      const caps = setRendererCapabilities(setup.renderer, { hyperlinks: true })
      setup.renderer.emit("capabilities", caps)
      const frame = await renderedFrame(setup, "Đã ghi src/x.ts")
      expect(linksIn(frame)).toEqual([])
    } finally {
      delete process.env.OPENTRADING_HYPERLINKS
    }
  })
})
