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
      "Dùng khi: việc cần từ 3 bước trở lên (phân tích nhiều mã, so sánh với ngành, đọc nhiều kỳ BCTC), hoặc người dùng đưa một danh sách việc. Ví dụ: so sánh VCB với TCB — tạo danh sách (lấy BCTC 4 quý VCB) → (lấy BCTC 4 quý TCB) → (so sánh NIM, CIR, CASA) → (viết kết luận), làm tới đâu đánh dấu tới đó.",
      "Không dùng khi: câu hỏi trả lời được trong một hai bước; danh sách chỉ có một việc (làm thẳng còn hơn).",
      "Nội dung mỗi việc viết cho người dùng đọc, theo việc cần làm (\"Lấy BCTC 4 quý của FPT\"), không ghi tên tool. Mỗi lần gọi gửi TOÀN BỘ danh sách. Đánh dấu in_progress trước khi bắt đầu một việc (chỉ MỘT việc in_progress tại một thời điểm), completed NGAY khi xong việc đó (không gom), cancelled nếu không làm nữa. CHỈ đánh completed khi việc xong triệt để: còn thiếu dữ liệu, tool còn lỗi hay kết quả chưa kiểm chứng thì giữ in_progress. Có thể gọi cùng lượt với các tool lấy dữ liệu.",
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
