import type { NotebookCommand } from "../../../core/memory/notebook/commands"
import { notebookAdmin } from "../../../core/memory/notebook/admin"
import type { MemoryProvider } from "../../../core/memory/types"
import { setState, type NotebookFormRequest } from "../../state"

/**
 * Where a notebook command goes from the command dispatcher. The dispatcher never holds the notebook's
 * write handle: it asks here, and either a form opens or it gets the reason it cannot. When the notebook
 * cannot be used nothing is opened, created or written, and the config is left alone; the caller keeps
 * what was typed so it is not lost.
 */

function requestFor(name: NotebookCommand, args: string): NotebookFormRequest {
  const arg = args.trim()
  switch (name) {
    case "nho":
      return { group: "constraint", text: arg }
    case "luandiem":
      // The whole argument is the code or name: a sector name has spaces ("Ngân hàng").
      return { group: "thesis", alias: arg }
    case "baihoc":
      return { group: "lesson", title: arg || undefined }
    case "quyetdinh":
      return { group: "decision", alias: arg }
  }
}

/** Opens a form for `request`; undefined when it opened, otherwise why not (nothing opened, nothing written). */
export function openNotebookRequest(memory: MemoryProvider, request: NotebookFormRequest, command?: string): string | undefined {
  const admin = notebookAdmin(memory)
  if (!admin) {
    const what = command ? `; /${command} chưa lưu gì` : ""
    const off = `Sổ ghi nhớ đang tắt${what}. Bật trong /config (mục Memory → Sổ ghi nhớ) rồi gõ lại.`
    return memory.id === "file" ? `${off} Lệnh này ghi vào sổ ghi nhớ, không ghi vào memory cũ.` : off
  }
  // A read that failed earlier may have passed (another window finished writing): read again before refusing.
  if (admin.problem()) admin.entries()
  const problem = admin.problem()
  if (problem) return problem
  showNotebookForm(request)
  return undefined
}

/** Opens a form from /memory, which already holds a working notebook. */
export function showNotebookForm(request: NotebookFormRequest) {
  setState({ notebookForm: request, notebookFormDirty: false, notebookFormAskLeave: false, dialog: "notebook-form" })
}

/** undefined: the form is open. A string: why it cannot open (nothing written, nothing opened). */
export function openNotebookForm(memory: MemoryProvider, name: NotebookCommand, args: string): string | undefined {
  return openNotebookRequest(memory, requestFor(name, args), name)
}
