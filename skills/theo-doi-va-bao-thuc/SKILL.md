---
name: theo-doi-va-bao-thuc
description: Lưu watchlist + đặt cảnh báo giá/RSI — vòng đời đầy đủ, skill ghi (READ_WRITE) duy nhất.
when_to_use: Theo dõi FPT + HPG, báo khi VCB vượt 60, tạo watchlist. Skill duy nhất thay đổi state server.
activation: auto
requires_tools: [mcp__opentrading__watchlist_create]
tool_budget: 10
triggers:
  keywords: [theo dõi, watchlist, cảnh báo, alert, báo khi, nhắc giá, lưu danh mục]
version: 1.0.0
---

# Theo dõi & báo thức

## Vòng đời

| Giai đoạn | Tools |
|---|---|
| Tạo | `watchlist_create` → `watchlist_add(list_id, symbols)` |
| Đọc | `watchlist_list` · `watchlist_get` → quote bằng `vn_equity_quote_batch`(1 call) |
| Alert | `alert_create(symbol,op,threshold,metric)` → `alert_list` |
| Kiểm tra định kỳ | `alert_check(rules)` (metric: price hoặc rsi14; op gồm cross_up/cross_down) |
| Bảo quản | `alert_pause/resume` · `watchlist_update/remove` · `watchlist_delete` |

## Verdict

Xác nhận state đã lưu (id, rules) + kết quả lần kiểm tra đầu ngay trong run (`alert_check`)
+ nêu vòng đời để user dùng lệnh tiếp theo.

## Chống tràn lan

- KHÔNG tạo alert trùng rule cũ (luôn `alert_list` trước `alert_create`); 1 watchlist cho 1 chủ đề; không xóa thay user khi chưa xin.

## Lỗi thường gặp

PG fail → file fallback (server tự xử lý, output ghi "stored local"). `alert_check` empty =
chưa trigger, ĐÚNG — không phải lỗi. Cross-state TTL 3600s: alert cross_up cần ≥2 lần gọi mới có prev.

## Nghiệm thu

"Theo dõi FPT+HPG, báo khi FPT>70" → state tạo được, `alert_check` chạy xanh, cleanup demo list sau test.
