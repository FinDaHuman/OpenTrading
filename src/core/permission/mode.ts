/**
 * Permission modes (Shift+Tab cycles them, as in Claude Code):
 * - `read-only` (‖ chỉ đọc, the default): reads run; a local file write or shell command asks
 *   each time, with "switch to ▸" as one of the answers.
 * - `ask` (▸ sửa có hỏi): every write or command asks; "this session" covers a folder.
 * - `auto` (▸▸ tự động): a classifier decides instead of the user (permission/auto).
 */

export type PermissionMode = "read-only" | "ask" | "auto"

export const MODE_LABEL: Record<PermissionMode, string> = {
  "read-only": "‖ chỉ đọc",
  ask: "▸ sửa có hỏi",
  auto: "▸▸ tự động",
}

/** The next mode for Shift+Tab: ‖ → ▸ → ▸▸ → ‖. */
export function cycleMode(mode: PermissionMode, withAuto = true): PermissionMode {
  const order: PermissionMode[] = withAuto ? ["read-only", "ask", "auto"] : ["read-only", "ask"]
  return order[(order.indexOf(mode) + 1) % order.length] ?? "read-only"
}

/**
 * The mode a session opens in (config `permissions.defaultMode`). ▸▸ auto that the user never
 * said yes to (set by hand, or picked in /config) opens as ▸ instead; the TUI then asks.
 */
export function startMode(permissions: { defaultMode?: string; autoAcknowledged?: boolean } | undefined): PermissionMode {
  const mode = permissions?.defaultMode
  if (mode === "auto") return permissions?.autoAcknowledged === true ? "auto" : "ask"
  return mode === "ask" ? "ask" : "read-only"
}

/** The mode line of the `<quyen_tep>` reminder: what the model may expect when it writes. */
export function modeNote(mode: PermissionMode): string {
  if (mode === "read-only")
    return "Chế độ quyền: ‖ chỉ đọc. Ghi file (write_file, edit_file) và chạy lệnh (shell) cần người dùng duyệt từng lần trong hộp thoại; vẫn gọi các tool này khi người dùng muốn tạo hay sửa file, đừng chỉ dán nội dung vào câu trả lời."
  if (mode === "ask") return "Chế độ quyền: ▸ sửa có hỏi. Mỗi lần ghi file hay chạy lệnh người dùng duyệt trong hộp thoại (có thể cho phép cả thư mục, hoặc một lệnh, trong phiên)."
  return "Chế độ quyền: ▸▸ tự động. Người dùng chọn để bạn làm liên tục không hỏi từng bước: một model duyệt từng hành động thay người dùng. Cứ làm các việc thường lệ người dùng yêu cầu (đọc, tạo file trong workspace, chạy script đã viết). Không tự xoá hay ghi đè dữ liệu có sẵn, không gửi dữ liệu ra ngoài, không đặt lệnh hay chuyển tiền thật khi người dùng chưa nói rõ đúng việc đó. Hành động bị chặn thì đọc lý do, làm cách khác an toàn hơn hoặc dừng lại giải thích; không tìm cách lách."
}
