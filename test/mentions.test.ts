import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pruneAttachments } from "../src/core/compact"
import { FileState } from "../src/core/fs/file-state"
import { Workspace } from "../src/core/fs/workspace"
import { visibleUserText } from "../src/core/agent"
import { transcriptFromMessages } from "../src/core/session/transcript"
import {
  attachMentions,
  attachmentAttrs,
  MENTION_FILE_CHARS,
  MENTION_TOTAL_CHARS,
  mentionText,
  parseMentions,
  type Attachments,
} from "../src/core/mentions"

let root: string
let outside: string
let ws: Workspace

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ot-mentions-"))
  root = path.join(base, "du-an")
  outside = path.join(base, "ngoai")
  await mkdir(path.join(root, "docs"), { recursive: true })
  await mkdir(outside)
  await writeFile(path.join(root, "ghi-chu.md"), "dòng 1\ndòng 2\ndòng 3\ndòng 4\n")
  await writeFile(path.join(root, "báo cáo.md"), "Doanh thu tăng\n")
  await writeFile(path.join(root, "docs", "a.md"), "A\n")
  await writeFile(path.join(root, ".env"), "KEY=secret\n")
  await writeFile(path.join(root, "lon.txt"), Array.from({ length: 3000 }, (_, i) => `dòng số ${i + 1} ${"x".repeat(20)}`).join("\n"))
  await writeFile(path.join(outside, "bi-mat.md"), "không được đọc\n")
  ws = new Workspace(root, { home: path.join(base, "home"), data: path.join(base, "data") })
})

afterAll(async () => {
  await rm(path.dirname(root), { recursive: true, force: true })
})

const attach = (text: string, history: ModelMessage[] = [], files?: FileState) => attachMentions(text, { workspace: ws, files, history, images: false })
const asMessage = (text: string, a: Attachments): ModelMessage => ({ role: "user", content: [{ type: "text", text }, ...a.parts.map((t) => ({ type: "text" as const, text: t }))] })

describe("parseMentions", () => {
  test("@word, @\"with spaces\", line ranges; never inside an e-mail address", () => {
    expect(parseMentions("xem @ghi-chu.md và @\"báo cáo.md\" rồi mail a@b.com")).toEqual([[{ path: "ghi-chu.md" }], [{ path: "báo cáo.md" }]])
    expect(parseMentions("@src/x.ts#L10-20 @y.ts#5")).toEqual([[{ path: "src/x.ts", from: 10, to: 20 }], [{ path: "y.ts", from: 5, to: undefined }]])
    // Sentence punctuation after the path is tried without it too.
    expect(parseMentions("đọc @ghi-chu.md, rồi")).toEqual([[{ path: "ghi-chu.md," }, { path: "ghi-chu.md" }]])
    expect(mentionText("báo cáo.md")).toBe('@"báo cáo.md"')
    expect(mentionText("docs/a.md")).toBe("@docs/a.md")
  })
})

describe("attachMentions", () => {
  test("a mentioned file is read for the model, as read_file would, and counts as read", async () => {
    const files = new FileState()
    const a = await attach("tóm tắt @ghi-chu.md giúp tôi", [], files)
    expect(a.files).toEqual([{ path: "ghi-chu.md", ok: true, note: "Đã đọc ghi-chu.md (4 dòng)" }])
    expect(a.parts).toHaveLength(1)
    const part = a.parts[0]!
    expect(attachmentAttrs(part)).toMatchObject({ path: "ghi-chu.md" })
    expect(part).toContain('harness đã đọc sẵn bằng read_file(path="ghi-chu.md")')
    expect(part).toContain("1\tdòng 1")
    expect(part.endsWith("</tep_dinh_kem>")).toBe(true)
    expect(files.get(path.join(root, "ghi-chu.md"))?.full).toBe(true)
  })

  test("line ranges, quoted names with spaces and Vietnamese, folders, trailing punctuation", async () => {
    const a = await attach('@ghi-chu.md#L2-3 @"báo cáo.md" @docs, @ghi-chu.md.')
    expect(a.files.map((f) => f.note)).toEqual(["Đã đọc ghi-chu.md (dòng 2–3/4)", "Đã đọc báo cáo.md (1 dòng)", "Đã đọc thư mục docs/", "Đã đọc ghi-chu.md (4 dòng)"])
    expect(a.parts[0]).toContain("offset=2, limit=2")
    expect(a.parts[0]).toContain("2\tdòng 2")
    expect(a.parts[0]).not.toContain("1\tdòng 1")
    expect(a.parts[2]).toContain("a.md")
  })

  test("outside the workspace, missing, or not a path: left as text", async () => {
    const a = await attach(`@${path.join(outside, "bi-mat.md")} @../ngoai/bi-mat.md @khong-co.md @FPT`)
    expect(a).toEqual({ parts: [], images: [], files: [] })
  })

  test("key files are named, not read", async () => {
    const a = await attach("@.env")
    expect(a.files[0]).toMatchObject({ ok: false })
    expect(a.parts[0]).not.toContain("KEY=secret")
    expect(attachmentAttrs(a.parts[0]!)?.bo_qua).toBe("1")
  })

  test("a big file is cut at the per-file cap, with where to read on", async () => {
    const a = await attach("@lon.txt")
    expect(a.parts[0]!.length).toBeLessThan(MENTION_FILE_CHARS + 1_500)
    expect(a.parts[0]).toMatch(/còn \d+ dòng; đọc tiếp với offset=\d+/)
    expect(a.files[0]!.note).toMatch(/^Đã đọc lon\.txt \(dòng 1–[\d.]+\/3\.000\)$/)
  })

  test("past the per-message cap, files are named for read_file instead", async () => {
    // 40k characters each: two fill 40k at the per-file cap, the third gets the 10k left, the fourth none.
    for (let i = 0; i < 4; i++) await writeFile(path.join(root, `lon-${i}.txt`), Array.from({ length: 1000 }, () => "z".repeat(39)).join("\n"))
    const a = await attach("@lon-0.txt @lon-1.txt @lon-2.txt @lon-3.txt")
    const sent = a.parts.filter((p) => !attachmentAttrs(p)?.tham_chieu)
    expect(sent.reduce((n, p) => n + p.length, 0)).toBeLessThan(MENTION_TOTAL_CHARS + 3_000)
    expect(a.parts.some((p) => attachmentAttrs(p)?.tham_chieu === "1")).toBe(true)
    expect(a.files.some((f) => f.note.includes("quá giới hạn"))).toBe(true)
  })

  test("the same unchanged file again sends one line, not the content", async () => {
    const first = await attach("@ghi-chu.md")
    const history = [asMessage("@ghi-chu.md", first)]
    const again = await attach("lại @ghi-chu.md", history)
    expect(again.files[0]!.note).toBe("ghi-chu.md (không đổi, đã gửi trước)")
    expect(again.parts[0]).not.toContain("dòng 1")
    // Another range is another attachment.
    expect((await attach("@ghi-chu.md#L1-2", history)).parts[0]).toContain("1\tdòng 1")
    // Changed on disk: sent again.
    await writeFile(path.join(root, "ghi-chu.md"), "mới\n")
    const later = new Date(Date.now() + 5_000)
    const { utimes } = await import("node:fs/promises")
    await utimes(path.join(root, "ghi-chu.md"), later, later)
    expect((await attach("@ghi-chu.md", history)).parts[0]).toContain("1\tmới")
  })

  test("the transcript and the classifier never see the file content", async () => {
    await writeFile(path.join(root, "x.md"), "NỘI-DUNG-FILE\n")
    const a = await attach("xem @x.md")
    const message = asMessage("xem @x.md", a)
    expect(visibleUserText(message)).toBe("xem @x.md")
    expect(transcriptFromMessages([message])).toEqual([{ kind: "user", text: "xem @x.md", files: [{ path: "x.md", ok: true, note: "Đã gắn x.md" }] }])
  })
})

describe("pruneAttachments", () => {
  const turn = (text: string, part: string): ModelMessage[] => [
    { role: "user", content: [{ type: "text", text }, { type: "text", text: part }] },
    { role: "assistant", content: "ok" },
  ]

  test("old attachments are cleared only once that saves enough; the last turns keep theirs", async () => {
    const big = (await attach("@lon.txt")).parts[0]!
    const small = (await attach("@docs/a.md")).parts[0]!
    // One old big file (~5k tokens) is under the 20k batch: nothing changes.
    const few = [...turn("1", big), ...turn("2", small), ...turn("3", small)]
    expect(pruneAttachments(few).pruned).toBe(0)
    // Five old big files: cleared together; the last two turns are untouched.
    const many = [...Array.from({ length: 5 }, (_, i) => turn(String(i), big)).flat(), ...turn("5", big), ...turn("6", big)]
    const { messages, pruned } = pruneAttachments(many)
    expect(pruned).toBe(5)
    const parts = messages.filter((m) => m.role === "user").map((m) => (m.content as { text: string }[])[1]!.text)
    expect(parts.slice(0, 5).every((p) => attachmentAttrs(p)?.da_don === "1" && !p.includes("dòng số"))).toBe(true)
    expect(parts.slice(5).every((p) => p === big)).toBe(true)
    // A cleared file is no longer "sent before": attaching it again sends the content.
    const again = await attachMentions("@lon.txt", { workspace: ws, history: messages.slice(0, 10), images: false })
    expect(again.parts[0]).toContain("dòng số 1 ")
  })

  test("content a later 'unchanged' stub points at is kept, even when its turn is pruned", async () => {
    const big = (await attach("@lon.txt")).parts[0]!
    const others = await Promise.all([0, 1, 2, 3].map(async (i) => (await attach(`@lon-${i}.txt`)).parts[0]!))
    const stub = (await attach("@lon.txt", [{ role: "user", content: [{ type: "text", text: big }] }])).parts[0]!
    expect(attachmentAttrs(stub)?.da_gui).toBe("1")
    const history = [...turn("1", big), ...others.flatMap((p, i) => turn(`o${i}`, p)), ...turn("lại", stub), ...turn("tiếp", "<tep_dinh_kem path=\"x\">\n</tep_dinh_kem>")]
    const { messages, pruned } = pruneAttachments(history)
    expect(pruned).toBe(4)
    expect((messages[0]!.content as { text: string }[])[1]!.text).toBe(big)
  })

  test("after compaction, a kept stub whose content was summarized away asks for a new read", async () => {
    const { withoutOrphanStubs } = await import("../src/core/mentions")
    const stub = '<tep_dinh_kem path="a.md" mtime="1" da_gui="1">\nkhông đổi\n</tep_dinh_kem>'
    const [m] = withoutOrphanStubs([{ role: "user", content: [{ type: "text", text: "lại" }, { type: "text", text: stub }] }])
    const text = (m!.content as { text: string }[])[1]!.text
    expect(attachmentAttrs(text)).toMatchObject({ path: "a.md", da_don: "1" })
    expect(text).toContain("gọi read_file")
  })

  test("compaction clears them whatever their size", () => {
    const part = '<tep_dinh_kem path="a.md" mtime="1">\nnội dung dài '.padEnd(800, "x") + "\n</tep_dinh_kem>"
    const history = [...turn("1", part), ...turn("2", part), ...turn("3", part)]
    expect(pruneAttachments(history, 0).pruned).toBe(1)
  })
})
