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
      "Writes the task list for the question being answered; the interface pins it so the user sees progress.",
      "Use when: you expect 3 or more tool rounds, or the user gives a list of tasks. Do not use when: 1–2 tool rounds will do.",
      "Each task is a stage (one round of parallel tool calls), not one per ticker. Send the whole list every time, updating it in the same round as the next step's tools; only one task in_progress.",
      "Mark completed ONLY when the task is really done (missing data or a failed tool keeps it in_progress; dropped means cancelled). The final answer step closes the list in the same step.",
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
      if (problems.length > 0) throw new Error(`The list is not valid; send the whole corrected list again:\n- ${problems.join("\n- ")}`)
      const { done, total } = todoProgress(todos)
      const note = "The interface is showing the list to the user; do NOT copy the list or this line into the answer."
      if (todos.length === 0) return `${TODO_PREFIX} the list is empty. ${note}`
      const running = todos.find((t) => t.status === "in_progress")
      const next = running ? ` Next: ${running.content}.` : done === total ? " The list is closed." : ""
      return `${TODO_PREFIX} (${done}/${total} done). ${note}${next}`
    },
  }
}
