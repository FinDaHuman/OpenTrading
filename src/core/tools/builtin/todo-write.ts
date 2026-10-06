import { TODO_PREFIX, TODO_WRITE, TodoWriteInput, renderTodos, todoProblems, todoProgress } from "../todos"
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
      "Ghi danh sách việc cần làm cho câu hỏi đang trả lời; giao diện ghim danh sách cho người dùng thấy tiến độ.",
      "Dùng khi việc cần từ 3 bước trở lên (phân tích nhiều mã, so sánh với ngành, đọc nhiều kỳ BCTC) hoặc khi người dùng đưa một danh sách việc. Không dùng cho câu hỏi trả lời được trong một hai bước.",
      "Mỗi lần gọi gửi toàn bộ danh sách. Đánh dấu in_progress trước khi bắt đầu một việc (chỉ một việc in_progress), completed ngay khi xong việc đó, cancelled nếu không làm nữa. Có thể gọi cùng lượt với các tool lấy dữ liệu.",
      "Không kể lại danh sách trong câu trả lời vì giao diện đã hiện. Nếu kết thúc lượt mà còn việc pending, nói rõ vì sao.",
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
      if (todos.length === 0) return `${TODO_PREFIX}: danh sách trống.`
      return `${TODO_PREFIX}: ${done}/${total} xong.\n${renderTodos(todos)}`
    },
  }
}
