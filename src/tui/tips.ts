/**
 * Tips under the working row once a turn has run for a while (Claude Code's spinner tips).
 * Each names a real key or command; none repeats twice in a row.
 */
export const TIPS = [
  "Gõ tiếp khi agent đang làm: tin được xếp hàng và gửi khi xong (↑ để sửa)",
  "ctrl+s cất bản nháp, hỏi câu khác, rồi ctrl+s lấy lại",
  "ctrl+o mở rộng kết quả tool và báo cáo của subagent",
  "ctrl+r tìm lại một câu hỏi cũ",
  "/skill <tên> bật một skill cho cả phiên",
  "/compact nén hội thoại khi context gần đầy",
  "shift+tab đổi chế độ quyền: chỉ đọc → sửa có hỏi → tự động",
  "/tasks xem các subagent chạy nền",
  "/export lưu hội thoại ra file Markdown",
  `${process.platform === "win32" ? "alt+v" : "ctrl+v"} dán ảnh từ clipboard (biểu đồ, BCTC chụp màn hình)`,
  "ctrl+g soạn câu hỏi dài trong trình soạn thảo",
  "/watchlist quản lý danh sách mã theo dõi",
  "/profile cho OpenTrading biết khẩu vị đầu tư của bạn",
  "/model đổi model: model rẻ cho câu hỏi nhanh, model mạnh cho phân tích sâu",
]

let last = -1

/** A tip other than the one shown last. */
export function pickTip(random: () => number = Math.random): string {
  let i = Math.floor(random() * TIPS.length)
  if (i === last) i = (i + 1) % TIPS.length
  last = i
  return TIPS[i]!
}
