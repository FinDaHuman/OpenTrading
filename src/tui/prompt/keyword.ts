import type { TextareaRenderable } from "@opentui/core"
import { deskKeywordRange } from "../../core/desk/keyword"
import { offsetWidth } from "./parts"

/**
 * Colours the `ultradesk` keyword in the prompt (Claude Code highlights `ultracode`), so the
 * user sees the request will be allowed to run a playbook. A plain, non-virtual extmark:
 * the text stays editable like any other.
 */
export class KeywordMark {
  private typeId: number | undefined
  private last: string | undefined

  constructor(
    private input: () => TextareaRenderable | undefined,
    private styleId: () => number | undefined,
  ) {}

  /** The text was replaced (setText may drop extmarks): the next update redraws. */
  reset() {
    this.last = undefined
  }

  update(text: string, enabled: boolean) {
    const input = this.input()
    if (!input) return
    const range = enabled ? deskKeywordRange(text) : undefined
    const key = range ? `${range.start}:${range.end}:${text.length}` : ""
    if (key === this.last) return
    this.last = key
    this.typeId ??= input.extmarks.registerType("desk-keyword")
    for (const mark of input.extmarks.getAllForTypeId(this.typeId)) input.extmarks.delete(mark.id)
    if (!range) return
    const start = offsetWidth(text.slice(0, range.start))
    input.extmarks.create({ start, end: start + offsetWidth(text.slice(range.start, range.end)), virtual: false, styleId: this.styleId(), typeId: this.typeId })
  }
}
