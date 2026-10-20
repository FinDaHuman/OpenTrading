import type { TextareaRenderable } from "@opentui/core"
import type { PromptImage } from "./image"

/**
 * Large pastes and images live in the prompt as short "pills" — `[Pasted text #1 +49 lines]`,
 * `[Image #2]` — like Claude Code. Each pill is a virtual extmark: the cursor jumps over it
 * and one Backspace deletes all of it (OpenTUI does both). The full text is put back when
 * the prompt is sent.
 */
export type PastePart =
  | { kind: "text"; text: string }
  | ({ kind: "image" } & PromptImage)
  /** A file picked from the `@` list: the pill is the mention itself (`@src/x.ts`), sent as typed. */
  | { kind: "file"; mention: string }

/** Claude Code: more than 800 characters, or more than two line breaks. */
export const PASTE_MAX_CHARS = 800
export const PASTE_MAX_NEWLINES = 2

const newlines = (text: string) => text.match(/\n/g)?.length ?? 0

export const isLargePaste = (text: string) => text.length > PASTE_MAX_CHARS || newlines(text) > PASTE_MAX_NEWLINES

/** Claude Code's label; "+N lines" counts line breaks. */
export function pasteLabel(id: number, text: string) {
  const n = newlines(text)
  return n === 0 ? `[Pasted text #${id}]` : `[Pasted text #${id} +${n} lines]`
}
export const imageLabel = (id: number) => `[Image #${id}]`
const labelOf = (id: number, part: PastePart) => (part.kind === "text" ? pasteLabel(id, part.text) : part.kind === "image" ? imageLabel(id) : part.mention)

const PART_LABEL = /\[(Pasted text|Image) #(\d+)(?: \+\d+ lines)?\]/g

/** A draft set aside (Ctrl+S, Ctrl+R) or kept in history (pastes only). */
export type DraftSnapshot = { text: string; pastes?: Record<string, string>; images?: Record<string, PromptImage>; files?: Record<string, string> }

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Width in textarea offsets: display cells, where a line break counts as one (opencode). */
export function offsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  return width
}

function offsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + offsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }
  return value.length
}

/** `value` between two textarea offsets (which are not string indices once text is wide). */
export function offsetSlice(value: string, start: number, end = offsetWidth(value)) {
  return value.slice(offsetIndex(value, start), offsetIndex(value, end))
}

/** What the prompt sends: pills expanded, images attached; `pastes` is for the history file. */
export type ExpandedPrompt = { text: string; images: PromptImage[]; pastes: Record<string, string> }

export class PromptParts {
  private parts = new Map<number, PastePart>()
  private marks = new Map<number, number>()
  private nextId = 1
  private typeId: number | undefined

  constructor(
    private input: () => TextareaRenderable | undefined,
    private styleId: () => number | undefined,
    /** File pills have their own colour. */
    private fileStyleId: () => number | undefined = styleId,
  ) {}

  private type(input: TextareaRenderable) {
    this.typeId ??= input.extmarks.registerType("prompt-part")
    return this.typeId
  }

  private mark(input: TextareaRenderable, start: number, label: string, id: number, file = false) {
    const mark = input.extmarks.create({
      start,
      end: start + offsetWidth(label),
      virtual: true,
      styleId: file ? this.fileStyleId() : this.styleId(),
      typeId: this.type(input),
    })
    this.marks.set(mark, id)
  }

  /** Put a pill at the cursor (and a space after it, so typing goes on after it). */
  insert(part: PastePart): string | undefined {
    const input = this.input()
    if (!input) return undefined
    // Pasting over a highlight replaces it: delete it first, or the cursor moves under us.
    if (input.hasSelection()) input.deleteSelection()
    const id = this.nextId++
    const label = labelOf(id, part)
    const start = input.cursorOffset
    input.insertText(label + " ")
    this.parts.set(id, part)
    this.mark(input, start, label, id, part.kind === "file")
    return label
  }

  /** Pills still in the prompt and still intact, left to right. */
  private live() {
    const input = this.input()
    if (!input || this.typeId === undefined) return []
    const text = input.plainText
    return input.extmarks
      .getAllForTypeId(this.typeId)
      .map((m) => ({ start: m.start, end: m.end, id: this.marks.get(m.id), slice: offsetSlice(text, m.start, m.end) }))
      .flatMap((m) => {
        const part = m.id === undefined ? undefined : this.parts.get(m.id)
        if (!part || m.id === undefined) return []
        // Partly deleted (Ctrl+W, a selection): what is left is plain text.
        return m.slice === labelOf(m.id, part) ? [{ ...m, id: m.id, part }] : []
      })
      .sort((a, b) => a.start - b.start)
  }

  /** Images still in the prompt (a deleted pill drops its image). */
  images(): PromptImage[] {
    return this.live().flatMap((m) => (m.part.kind === "image" ? [{ data: m.part.data, mediaType: m.part.mediaType }] : []))
  }

  /** The prompt as sent: text pills replaced by what was pasted, `[Image #N]` kept next to the image. */
  expand(): ExpandedPrompt {
    const input = this.input()
    let text = input?.plainText ?? ""
    const live = this.live()
    const pastes: Record<string, string> = {}
    for (const m of [...live].reverse()) {
      if (m.part.kind !== "text") continue
      pastes[m.id] = m.part.text
      text = offsetSlice(text, 0, m.start) + m.part.text + offsetSlice(text, m.end)
    }
    return { text, images: this.images(), pastes }
  }

  /** The draft as it reads in the box, with what its pills hold (history keeps only `pastes`). */
  snapshot(): DraftSnapshot {
    const pastes: Record<string, string> = {}
    const images: Record<string, PromptImage> = {}
    const files: Record<string, string> = {}
    for (const m of this.live()) {
      if (m.part.kind === "text") pastes[m.id] = m.part.text
      else if (m.part.kind === "image") images[m.id] = { data: m.part.data, mediaType: m.part.mediaType }
      else files[m.id] = m.part.mention
    }
    return { text: this.input()?.plainText ?? "", pastes, images, files }
  }

  /** Forget the pills (the text was replaced). Numbers keep counting up, as in Claude Code. */
  reset() {
    this.parts.clear()
    this.marks.clear()
  }

  /**
   * After the box was set to some text (history, stash, search), turn the labels whose
   * content is known back into pills. Others stay plain text (history keeps no images).
   */
  restore(saved: Omit<DraftSnapshot, "text"> | undefined) {
    this.reset()
    const input = this.input()
    if (!input || !saved) return
    const text = input.plainText
    for (const match of text.matchAll(PART_LABEL)) {
      const id = Number(match[2])
      const content = match[1] === "Pasted text" ? saved.pastes?.[id] : undefined
      const image = match[1] === "Image" ? saved.images?.[id] : undefined
      const part: PastePart | undefined =
        content !== undefined && match[0] === pasteLabel(id, content) ? { kind: "text", text: content } : image ? { kind: "image", ...image } : undefined
      if (!part) continue
      this.parts.set(id, part)
      this.mark(input, offsetWidth(text.slice(0, match.index)), match[0], id)
      this.nextId = Math.max(this.nextId, id + 1)
    }
    // File pills are their own text: find each, left to right.
    let from = 0
    for (const [key, mention] of Object.entries(saved.files ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const at = text.indexOf(mention, from)
      if (at < 0) continue
      const id = Number(key)
      this.parts.set(id, { kind: "file", mention })
      this.mark(input, offsetWidth(text.slice(0, at)), mention, id, true)
      this.nextId = Math.max(this.nextId, id + 1)
      from = at + mention.length
    }
  }
}
