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
      "Ghi danh sách việc cần làm cho câu hỏi đang trả lời; giao diện ghim danh sách cho người dùng thấy tiến độ.",
      "Dùng khi: dự kiến từ 3 lượt gọi tool trở lên, hoặc người dùng đưa một danh sách việc. Không dùng khi: trả lời được trong 1-2 lượt tool; danh sách chỉ có một việc.",
      "Mỗi việc là một GIAI ĐOẠN, ứng với một lượt gọi tool song song hoặc một bước suy luận — KHÔNG chia theo từng mã khi sẽ lấy dữ liệu các mã cùng lúc. Ví dụ phân tích VCB, FPT, AAA: (Lấy dữ liệu cơ bản 3 mã) → (Phân tích và so sánh) → (Kết luận). Nội dung viết cho người dùng đọc, không ghi tên tool.",
      "Mỗi lần gọi gửi TOÀN BỘ danh sách. Cập nhật trạng thái CÙNG lượt với các tool của bước kế tiếp (không tốn lượt riêng): việc vừa có đủ dữ liệu → completed, việc kế tiếp → in_progress (chỉ MỘT việc in_progress). Nhiều việc xong trong cùng một lượt thì đóng cùng lúc. CHỈ đánh completed khi việc xong thật: còn thiếu dữ liệu hay tool còn lỗi thì giữ in_progress; bỏ việc thì cancelled.",
      "Bước trả lời cuối: viết câu trả lời VÀ gọi todo_write đóng danh sách trong cùng bước đó.",
      "Giao diện đã hiện danh sách: không chép danh sách hay kết quả của tool này vào câu trả lời. Nếu kết thúc lượt mà còn việc chưa làm, nói rõ vì sao.",
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
