import { TODO_PREFIX, TODO_WRITE, TodoWriteInput, todoProblems, todoProgress } from "../todos"
import type { ToolDef } from "../types"

/**
 * `todo_write`: the model keeps a checklist for multi-step analyses. The whole list is sent
 * each time (no per-item edits). The TUI pins the open items above the input, and the agent
 * recites them in every turn's reminder, so a weak model keeps its goal in view.
 */
export function todoWriteTool(): ToolDef<TodoWriteInput> {
  return {
    name: TODO_WRITE,
    description: [
      "Ghi danh sách việc cho câu hỏi đang trả lời; giao diện ghim cho người dùng thấy tiến độ.",
      "Dùng khi: dự kiến từ 3 lượt gọi tool, hoặc người dùng đưa danh sách việc. Không dùng khi: 1–2 lượt tool là xong.",
      "Mỗi việc là một giai đoạn (một lượt gọi tool song song), không chia theo từng mã. Gửi toàn bộ danh sách mỗi lần, cập nhật cùng lượt với tool của bước kế tiếp; chỉ một việc in_progress.",
      "CHỈ đánh completed khi việc xong thật (thiếu dữ liệu hay tool lỗi thì giữ in_progress; bỏ thì cancelled). Bước trả lời cuối đóng danh sách trong cùng bước.",
    ].join(" "),
    input: TodoWriteInput,
    readOnly: true,
    approval: "never",
    summarize: (input) => {
      const { done, total } = todoProgress(input.todos)
      return `Cập nhật việc cần làm (${done}/${total} xong)`
    },
    async execute({ todos }) {
      const problems = todoProblems(todos)
      if (problems.length > 0) throw new Error(`Danh sách chưa hợp lệ, gửi lại toàn bộ danh sách đã sửa:\n- ${problems.join("\n- ")}`)
      const { done, total } = todoProgress(todos)
      const note = "Giao diện đang hiện danh sách cho người dùng; KHÔNG chép danh sách hay dòng này vào câu trả lời."
      if (todos.length === 0) return `${TODO_PREFIX} danh sách trống. ${note}`
      const running = todos.find((t) => t.status === "in_progress")
      const next = running ? ` Làm tiếp: ${running.content}.` : done === total ? " Danh sách đã đóng." : ""
      return `${TODO_PREFIX} (${done}/${total} xong). ${note}${next}`
    },
  }
}
