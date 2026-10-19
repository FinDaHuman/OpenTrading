/**
 * Permission modes (Shift+Tab cycles them; Claude Code getNextPermissionMode.ts):
 * - `read-only` (‖ chỉ đọc, the default): reads run; a local file write or shell command asks
 *   each time, with "switch to ▸" as one of the answers.
 * - `ask` (▸ sửa có hỏi): every write or command asks; "this session" covers a folder.
 * - `auto` (▸▸ tự động): a classifier decides instead of the user (not offered yet).
 */

export type PermissionMode = "read-only" | "ask" | "auto"

export const MODE_LABEL: Record<PermissionMode, string> = {
  "read-only": "‖ chỉ đọc",
  ask: "▸ sửa có hỏi",
  auto: "▸▸ tự động",
}

/** The next mode for Shift+Tab. Auto mode joins the cycle once it exists (`withAuto`). */
export function cycleMode(mode: PermissionMode, withAuto = false): PermissionMode {
  const order: PermissionMode[] = withAuto ? ["read-only", "ask", "auto"] : ["read-only", "ask"]
  return order[(order.indexOf(mode) + 1) % order.length] ?? "read-only"
}

/** The mode line of the `<quyen_tep>` reminder: what the model may expect when it writes. */
export function modeNote(mode: PermissionMode): string {
  if (mode === "read-only")
    return "Chế độ quyền: ‖ chỉ đọc. Ghi file (write_file, edit_file) cần người dùng duyệt từng lần trong hộp thoại; vẫn gọi các tool này khi người dùng muốn tạo hay sửa file, đừng chỉ dán nội dung vào câu trả lời."
  if (mode === "ask") return "Chế độ quyền: ▸ sửa có hỏi. Mỗi lần ghi file người dùng duyệt trong hộp thoại (có thể cho phép cả thư mục trong phiên)."
  return "Chế độ quyền: ▸▸ tự động."
}
