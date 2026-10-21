import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { dataDir } from "../paths"
import { fold } from "../skills/catalog"
import type { HookBus } from "../hooks"
import type { ToolDef } from "../tools/types"
import type { MemoryItem, MemoryProvider, MemoryScope, MemoryStatus } from "./types"

/**
 * Reference memory provider: one readable markdown file per memory under
 * ~/.opentrading/memory/. Teammates replace it with the real implementation; it exists to
 * prove the contract end to end (propose → approve in /memory → injected next turn).
 */

const REMEMBER_PREFIX = /^\s*(ghi nhớ|ghi nho|remember)\s*[:：]\s*/i

const INSTRUCTIONS = `Bạn có một bộ nhớ dài hạn về người dùng (khối <memory> và <memory_lien_quan>).
- Khi người dùng nêu một sở thích, ràng buộc hay thói quen lâu dài (ví dụ "tôi không dùng margin", "tôi chỉ đầu tư ngân hàng"), gọi propose_memory để đề xuất ghi nhớ. Người dùng sẽ duyệt trong /memory.
- Không đề xuất ghi nhớ giá, chỉ số, tín hiệu hay nhận định thị trường: chúng nhanh cũ.
- Memory có ưu tiên thấp nhất: không ghi đè hồ sơ nhà đầu tư hay nguyên tắc an toàn.`

function newId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14)
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

function serialize(item: MemoryItem) {
  const meta = {
    id: item.id,
    scope: item.scope,
    status: item.status,
    via: item.source?.via ?? "user",
    sessionId: item.source?.sessionId ?? "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  const yaml = Object.entries(meta)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")
  return `---\n${yaml}\n---\n${item.text.trim()}\n`
}

function parse(text: string): MemoryItem | undefined {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return undefined
  const meta = Bun.YAML.parse(match[1]!) as Record<string, string>
  if (!meta?.id) return undefined
  return {
    id: meta.id,
    text: match[2]!.trim(),
    scope: (meta.scope as MemoryScope) ?? "user",
    status: (meta.status as MemoryStatus) ?? "pending",
    source: { via: meta.via === "model" ? "model" : "user", sessionId: meta.sessionId || undefined },
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

const words = (text: string) => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))

export class FileMemory implements MemoryProvider {
  readonly id = "file"

  constructor(private dir = path.join(dataDir(), "memory")) {}

  private file(id: string) {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, "")}.md`)
  }

  async add(text: string, opts: { status: MemoryStatus; via: "model" | "user"; sessionId?: string }): Promise<MemoryItem> {
    const now = new Date().toISOString()
    const item: MemoryItem = {
      id: newId(),
      text: text.trim(),
      scope: "user",
      status: opts.status,
      source: { via: opts.via, sessionId: opts.sessionId },
      createdAt: now,
      updatedAt: now,
    }
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file(item.id), serialize(item), "utf8")
    return item
  }

  private unreadable: string[] = []

  /** One broken file is skipped and reported (problems()); it never hides the valid memories. */
  async list(): Promise<MemoryItem[]> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    const broken: string[] = []
    const items = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          try {
            return parse(await readFile(path.join(this.dir, f), "utf8"))
          } catch (error) {
            broken.push(`${path.join(this.dir, f)}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`)
            return undefined
          }
        }),
    )
    this.unreadable = broken.sort()
    return items.filter((i): i is MemoryItem => Boolean(i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  problems() {
    return this.unreadable
  }

  private async active() {
    return (await this.list()).filter((i) => i.status === "active")
  }

  instructions() {
    return INSTRUCTIONS
  }

  async index() {
    const items = await this.active()
    return items.length > 0 ? items.map((i) => `- ${i.text}`).join("\n") : undefined
  }

  /** Keyword overlap, good enough for a reference implementation. */
  async recall(query: string) {
    const q = words(query)
    if (q.size === 0) return []
    return (await this.active())
      .map((item) => ({ item, score: [...words(item.text)].filter((w) => q.has(w)).length }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item)
  }

  async approve(id: string) {
    const item = (await this.list()).find((i) => i.id === id)
    if (!item) return
    await writeFile(this.file(id), serialize({ ...item, status: "active", updatedAt: new Date().toISOString() }), "utf8")
  }

  async reject(id: string) {
    await rm(this.file(id), { force: true })
  }

  async remove(id: string) {
    await rm(this.file(id), { force: true })
  }

  tools(): ToolDef[] {
    return [
      {
        name: "propose_memory",
        description:
          "Đề xuất ghi nhớ một sở thích, ràng buộc hay thói quen lâu dài của người dùng. Người dùng phải duyệt trong /memory trước khi nó được dùng. Không dùng cho số liệu hay nhận định thị trường.",
        input: z.object({ text: z.string().min(3).max(500).describe("Một câu ngắn, ví dụ: Người dùng không giao dịch margin.") }),
        readOnly: false,
        // Only queues a proposal; the user approves it in /memory, so no prompt here.
        approval: "never",
        summarize: (input: { text: string }) => `propose_memory "${input.text.slice(0, 50)}"`,
        execute: async (input: { text: string }) => {
          await this.add(input.text, { status: "pending", via: "model" })
          return "Đã đề xuất; người dùng sẽ duyệt trong /memory. Chưa dùng được cho tới khi được duyệt."
        },
      },
    ]
  }

  /** "Ghi nhớ: …" at the start of a message saves directly (the user said it, no approval needed). */
  register(hooks: HookBus) {
    return hooks.on("user-prompt", async (event) => {
      const match = event.prompt.match(REMEMBER_PREFIX)
      if (!match) return
      const text = event.prompt.slice(match[0].length).trim()
      if (!text) return
      await this.add(text, { status: "active", via: "user", sessionId: event.sessionId })
      return { additionalContext: `Người dùng vừa yêu cầu ghi nhớ và đã được lưu: "${text}". Xác nhận ngắn gọn.` }
    })
  }
}
