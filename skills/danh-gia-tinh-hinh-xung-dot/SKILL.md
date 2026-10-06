---
name: danh-gia-tinh-hinh-xung-dot
description: Đánh giá 1 cuộc xung đột vũ trang (cường độ, giá dầu/vàng đã phản ánh chưa, kênh truyền dẫn, xác suất leo thang) trong tối đa 9 calls. Luôn dùng skill này khi user hỏi xung đột/chiến sự cụ thể và ảnh hưởng của nó tới thị trường — ví dụ "Trung Đông leo thang, dầu lên không", "Biển Đông căng thẳng ảnh hưởng gì" — ngay cả khi user không nói rõ muốn "đánh giá xung đột".
activation: auto
requires_tools: [mcp__opentrading__event_stats]
tool_budget: 9
triggers:
  keywords: [xung đột, chiến tranh, biển đông, trung đông, leo thang, dầu hay vàng lên, chiến sự]
version: 1.1.0
---

# Assessing Armed-Conflict Market Impact

Trả lời 5 mục cố định: cường độ → giá đã phản ánh → kênh truyền dẫn → xác suất leo thang → hàm ý vị thế. Không khuyến nghị mua/bán trực tiếp.

## When to Use

- Dùng khi: user nêu 1 xung đột/chiến sự cụ thể + hỏi cường độ, leo thang, giá đã phản ánh, kênh truyền dẫn, hàm ý vị thế.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chính trị/bầu cử rộng → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Bất ổn 1 nước (biểu tình/đảo chính, chưa thành chiến sự) → dùng `bat-on-quoc-gia`.
  - Chỉ xin odds thuần → dùng `du-doan-polymarket`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: đo cường độ (GDELT, song song)
- [ ] Step 2: kiểm tra giá đã phản ánh (dầu/vàng, song song)
- [ ] Step 3: odds leo thang + xác minh (chỉ khi cần)
- [ ] Step 4: verdict 5 mục
```

**Step 1: Đo cường độ (bắt buộc, song song).**

Chạy `geo_intel` (topic xung đột) + `event_stats` (query) cùng lúc. Từ khóa thử cả tiếng Việt lẫn Anh; GDELT rỗng với tiếng Việt là đặc trưng data (ghi "query VN rỗng, dùng EN query X", retry tối đa 1 lần EN), không phải lỗi.

**Step 2: Kiểm tra giá đã phản ánh (song song, tuần tự sau Step 1).**

Chạy `yf_commodities` (dầu + vàng) + `assets_rotation`. Thiếu phiên mới thì dùng phiên gần nhất có + ghi rõ date, không bịa giá hiện tại. Đủ counts Step 1 + giá dầu/vàng Step 2 là đủ verdict cơ bản.

**Step 3: Odds leo thang + xác minh (chỉ khi cần).**

Chạy `world_prediction_odds` (từ khóa cuộc chiến) + `web_search`/`web_fetch` (chỉ 1-2 nguồn). Không có market cho cuộc chiến thì ghi "không có odds", không thay bằng nhận định riêng.

**Step 4: Validate trước khi chốt.**

Chỉ 1 topic/call; từ khóa tối đa 2 lần thử ("biển đông" → "south china sea") rồi chấp nhận "ít coverage". Không mở rộng sang nhiều cuộc chiến trong 1 run (user hỏi rộng thì đề nghị tách từng xung đột).

## Template

ALWAYS use this exact verdict structure:

1. **Cường độ:** event counts GDELT trend (đơn vị counts + trend tăng/giảm) + URL.
2. **Giá đã phản ánh chưa:** dầu/vàng move vs baseline (đơn vị USD/thùng, USD/oz, % move) + URL.
3. **Kênh truyền dẫn:** energy → inflation → rates, 1–2 dòng + URL.
4. **Xác suất leo thang:** odds prob_pct (đơn vị %) + end-date + URL event.
5. **Hàm ý vị thế:** cushion/size (tham chiếu leg 6 `danh-gia-truoc-bctc`), KHÔNG khuyến nghị mua/bán trực tiếp.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Xung đột ảnh hưởng dầu/vàng
Output: `geo_intel("Vietnam")` trả articles · `event_stats("vietnam")` articles >0 · gold 4,195 USD/oz cùng phiên → verdict đủ 5 mục, có số dầu/vàng phiên gần nhất.
