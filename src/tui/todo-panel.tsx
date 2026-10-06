import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo } from "solid-js"
import { currentTodos, hasOpenTodos, todoMark, todoProgress, type Todo } from "../core/tools/todos"
import { state } from "./state"
import { color } from "./theme"
import { truncate } from "./ui/text"

export const TODO_PANEL_ROWS = 6

/** The list as the TUI shows it: this turn's last accepted todo_write, else history's. */
export const shownTodos = (): Todo[] => state.liveTodos ?? currentTodos(state.history)

const RANK: Record<Todo["status"], number> = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 }

/**
 * At most `rows` items, chosen by what matters now (doing, then waiting, then done) but shown
 * in the model's order; the rest are counted.
 */
export function visibleTodos(todos: readonly Todo[], rows = TODO_PANEL_ROWS) {
  if (todos.length <= rows) return { items: [...todos], hidden: 0 }
  const keep = new Set(
    todos
      .map((todo, index) => ({ todo, index }))
      .sort((a, b) => RANK[a.todo.status] - RANK[b.todo.status] || a.index - b.index)
      .slice(0, rows - 1)
      .map((x) => x.index),
  )
  return { items: todos.filter((_, i) => keep.has(i)), hidden: todos.length - keep.size }
}

/**
 * Open todo items pinned above the prompt (Claude Code TaskList, opencode sidebar). Hidden
 * once nothing is left to do.
 */
export function TodoPanel() {
  const dims = useTerminalDimensions()
  const todos = createMemo(shownTodos)
  const shown = createMemo(() => visibleTodos(todos()))
  const progress = createMemo(() => todoProgress(todos()))
  const width = () => Math.max(10, dims().width - 10)

  return (
    <Show when={hasOpenTodos(todos())}>
      <box
        flexShrink={0}
        flexDirection="column"
        marginLeft={2}
        marginRight={2}
        border={["top"]}
        borderColor={color.rule}
        backgroundColor={color.bg}
        paddingLeft={1}
      >
        <text fg={color.tx2} wrapMode="none" selectable={false}>
          <span style={{ bold: true }}>Việc cần làm</span>
          <span style={{ fg: color.tx3 }}>{` · ${progress().done}/${progress().total}`}</span>
        </text>
        <For each={shown().items}>
          {(todo) => (
            <text wrapMode="none" fg={todo.status === "in_progress" ? color.tham : todo.status === "pending" ? color.tx : color.tx3}>
              <span style={{ bold: todo.status === "in_progress" }}>{`${todoMark(todo.status)} ${truncate(todo.content, width())}`}</span>
            </text>
          )}
        </For>
        <Show when={shown().hidden > 0}>
          <text fg={color.tx3} wrapMode="none" selectable={false}>{`… +${shown().hidden} việc`}</text>
        </Show>
      </box>
    </Show>
  )
}
