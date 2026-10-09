---
name: ve-bieu-do
description: "Vẽ biểu đồ màu trong terminal từ dữ liệu MCP đã có (nến+volume, đường giá, chỉ số, bar, pie, waterfall, stacked, boxplot, scatter, heatmap, gauge, sổ lệnh). Dùng khi người dùng muốn XEM biểu đồ, hoặc khi data phân tích có thể trực quan hóa."
activation: auto
requires_tools: [chart_render, chart_compare, chart_depth]
triggers:
  keywords: [vẽ biểu đồ, vẽ chart, vẽ nến, biểu đồ, đồ thị, chart, candlestick, sparkline, heatmap, gauge, donut, histogram, pie, waterfall, multiline, boxplot, scatter, nến, cột, tỷ trọng, dòng tiền, sổ lệnh, orderbook]
version: 1.0.0
---

# Vẽ biểu đồ màu trong terminal

Skill thuần hiển thị: số liệu lấy từ tool dữ liệu mỗi lần gọi, không có số live cố định — không bịa số minh họa thành số thật. Dùng lại dữ liệu đã có trong context, không fetch lại.

## Procedure — làm theo thứ tự

1. **Nhìn shape data trước khi vẽ.** Đếm số cột, kiểu cột (time / giá / ±số / % / ma trận 2D), số điểm, đơn vị có đồng nhất không.
2. **Duyệt cây quyết định** `references/choosing-a-form.md`: trả lời từng nút yes/no → **DỪNG ở node ★ đầu tiên khớp** → lấy danh sách candidates → **chọn 1 theo context câu hỏi user** (gợi ý chọn ghi dưới mỗi node ★). Chưa chắc tham số vẽ → đọc reference kind đó, CHỈ đọc file cần.
3. **Lấy đủ data tối thiểu** (ngưỡng ghi trong từng node cây) rồi chạy `chart_render` (+symbol, +times trục X) / `chart_compare` / `chart_depth`.
4. Đối chiếu `references/anti-patterns.md` trước khi trả lời.
5. **Verdict 2–3 câu** đọc từ hình + số (trend, HH/LL, vị trí trong biên độ, đơn vị kVND: 57.3 = 57,300đ). Chart màu tự hiện trong TUI — KHÔNG chép hình vào câu trả lời.

## Non-negotiables

- **Nhìn shape trước, không map theo tên tool.** Cùng tool có thể ra nhiều shape (vd `money_flow` vừa có sign → winloss, vừa có BuyVal−SellVal → waterfall).
- **Multiline cấm vẽ giá nhiều mã** (lệch magnitude → xẹp hình) — giá nhiều mã dùng `chart_compare`.
- **Pie >7 lát → bar.** 1 value/max → donut, không pie 2 lát.
- **Trục X khớp mọi chart time-series**: `┤` cố định cột 7, plot rộng cố định, ngày đầu trái — ngày cuối phải, dài thì quay dọc.
- **Màu theo bảng giá VN**: tăng xanh lá, giảm đỏ — không tự phối màu.
- **Mọi chart có đơn vị**: luôn truyền `unit` khi biết (kVND, %, tỷ, triệu cp...) — hiện ở tiêu đề `[unit]`.
- **Trục X có đường ngang + chấm từng điểm**; trục Y riêng từng chart con (compare).
- **Không vẽ chay**: thiếu điểm tối thiểu thì báo, không bịa.

## Reference files

| File | Trả lời câu hỏi |
|---|---|
| `references/choosing-a-form.md` | Shape nào → chart nào, và TRÁNH chart nào |
| `references/time-series.md` | Nến+volume chuẩn TV, line/area/spark, trục X khớp |
| `references/comparison.md` | Bar diverging gốc 0, boxplot, histogram, compare % |
| `references/part-to-whole.md` | Pie/donut thanh tỷ lệ, stacked, waterfall |
| `references/relationship.md` | Scatter groups, multiline chỉ số, heatmap gradient |
| `references/anti-patterns.md` | Những gì KHÔNG được vẽ |
