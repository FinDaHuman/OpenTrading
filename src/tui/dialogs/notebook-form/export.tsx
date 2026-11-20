import { createSignal } from "solid-js"
import type { NotebookAdmin } from "../../../core/memory/notebook/admin"
import { say } from "../../notify"
import { leaveNotebookForm } from "../../state"
import { createFormUi, FormFrame } from "./frame"

/**
 * Export the notebook to a Markdown file in the app's exports folder (never a workspace). The decision log
 * is left out unless turned on for this export; the choice is not remembered, so the next export starts off.
 */
export function ExportForm(props: { admin: NotebookAdmin }) {
  const ui = createFormUi()
  const [withDecisions, setWithDecisions] = createSignal(false)
  const [asFolder, setAsFolder] = createSignal(false)
  const [running, setRunning] = createSignal(false)

  async function run() {
    setRunning(true)
    const result = await props.admin.exportMarkdown({ decisions: withDecisions(), folder: asFolder() })
    setRunning(false)
    if (!result.ok) {
      ui.setError(result.message)
      return say(result.message, "error")
    }
    say(`Đã xuất sổ ghi nhớ: ${result.file}`, "success", 12_000)
    leaveNotebookForm()
  }

  return (
    <FormFrame
      ui={ui}
      title="Xuất sổ ghi nhớ ra Markdown"
      fields={[
        {
          id: "decisions",
          label: "Kèm nhật ký quyết định",
          kind: "choice",
          options: [
            { value: "no", label: "Không" },
            { value: "yes", label: "Có" },
          ],
          value: withDecisions() ? "yes" : "no",
          onPick: (v) => setWithDecisions(v === "yes"),
        },
        {
          id: "format",
          label: "Dạng",
          kind: "choice",
          options: [
            { value: "file", label: "Một file" },
            { value: "folder", label: "Thư mục theo loại" },
          ],
          value: asFolder() ? "folder" : "file",
          onPick: (v) => setAsFolder(v === "folder"),
        },
      ]}
      info={[
        "File ghi vào thư mục xuất của OpenTrading (exports trong thư mục dữ liệu), không phải thư mục làm việc.",
        "Thư mục theo loại: mỗi mục một file Markdown có frontmatter, thêm README.md làm mục lục.",
        "File xuất là bản sao; xoá trong sổ không xoá file này.",
      ]}
      warnings={
        withDecisions() ? ["File sẽ có nhật ký quyết định. Model đọc được file này nếu bạn đưa nó vào thư mục làm việc."] : []
      }
      buttons={[{ id: "export", label: running() ? "Đang xuất…" : "Xuất", enabled: !running(), run: () => void run() }]}
      dirty={false}
    />
  )
}
