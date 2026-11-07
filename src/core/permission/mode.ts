/**
 * Permission modes (Shift+Tab cycles them, as in Claude Code):
 * - `read-only` (‖ chỉ đọc, the default): reads run; a local file write or shell command asks
 *   each time, with "switch to ▸" as one of the answers.
 * - `ask` (▸ sửa có hỏi): every write or command asks; "this session" covers a folder.
 * - `auto` (▸▸ tự động): a classifier decides instead of the user (permission/auto).
 * - `bypass` (▸▸▸ bỏ qua quyền, Claude Code's bypass permissions mode): nothing asks, no classifier
 *   request either. Only a session started with `--yolo` has it; config and resume never turn
 *   it on. Deny rules, ask rules, blocked calls and the user-only scopes (key files, tool
 *   config folders, outside the workspace, the loop guard) still stop or ask.
 */

export type PermissionMode = "read-only" | "ask" | "auto" | "bypass"

export const MODE_LABEL: Record<PermissionMode, string> = {
  "read-only": "‖ chỉ đọc",
  ask: "▸ sửa có hỏi",
  auto: "▸▸ tự động",
  bypass: "▸▸▸ bỏ qua quyền",
}

/** The flags that start a session in ▸▸▸ bypass (Codex `--yolo`, Claude Code's long name). */
export const YOLO_FLAGS = ["--yolo", "--dangerously-skip-permissions"]

/** The next mode for Shift+Tab: ‖ → ▸ → ▸▸ (→ ▸▸▸ when started with --yolo) → ‖. */
export function cycleMode(mode: PermissionMode, opts: { auto?: boolean; bypass?: boolean } = {}): PermissionMode {
  const order: PermissionMode[] = ["read-only", "ask"]
  if (opts.auto !== false) order.push("auto")
  if (opts.bypass) order.push("bypass")
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
  if (mode === "bypass")
    return "Chế độ quyền: ▸▸▸ bỏ qua quyền. Người dùng chạy bạn với --yolo: ghi file, chạy lệnh và tool ghi chạy ngay, không ai duyệt. Vì vậy tự cẩn trọng: chỉ làm đúng việc được yêu cầu, không xoá hay ghi đè dữ liệu có sẵn, không gửi dữ liệu ra ngoài, không đặt lệnh hay chuyển tiền thật khi người dùng chưa nói rõ. Luật chặn của người dùng, file khoá, thư mục cấu hình (.git, .opentrading…) và ngoài workspace vẫn cần người dùng; bị từ chối thì không làm cùng việc đó bằng cách khác."
  return "Chế độ quyền: ▸▸ tự động. Người dùng chọn để bạn làm liên tục không hỏi từng bước: một model duyệt từng hành động thay người dùng. Cứ làm các việc thường lệ người dùng yêu cầu (đọc, tạo file trong workspace, chạy script đã viết). Không tự xoá hay ghi đè dữ liệu có sẵn, không gửi dữ liệu ra ngoài, không đặt lệnh hay chuyển tiền thật khi người dùng chưa nói rõ đúng việc đó. Hành động bị chặn thì làm theo chỉ dẫn trong kết quả: không làm đúng việc đó bằng tool, lệnh hay subagent khác; làm tiếp việc không phụ thuộc; việc bắt buộc thì dừng lại, nói lý do và để người dùng quyết."
}
