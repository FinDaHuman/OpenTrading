---
name: ve-bieu-do
description: "Vẽ biểu đồ màu trong terminal từ dữ liệu tool đã có (nến + khối lượng, đường giá, bar, pie, waterfall, heatmap, sổ lệnh…). Dùng khi người dùng muốn xem biểu đồ, hoặc khi chuỗi số khó đọc dạng bảng và cần trực quan hóa."
activation: auto
requires_tools: [chart_render]
uses_tools: [chart_render, chart_compare, chart_depth]
triggers:
  keywords: [vẽ biểu đồ, vẽ chart, vẽ nến, biểu đồ nến, biểu đồ, đồ thị, candlestick, sparkline, heatmap, gauge, donut, histogram, waterfall, multiline, boxplot, scatter, vẽ sổ lệnh]
version: 1.1.1
---

# Vẽ biểu đồ màu trong terminal

Skill hiển thị: số liệu luôn lấy từ kết quả tool trong phiên, không bao giờ bịa số minh họa.

## Các bước

1. **Vẽ theo tham chiếu.** Mỗi kết quả tool có dữ liệu dạng mảng mở đầu bằng mã `[ref rN]`. Gọi `chart_render({from_call: "rN", kind})` (so sánh nhiều mã: `chart_compare({from_calls: ["r1", "r2"]})`) để harness tự lấy số — không gõ lại từng con số. Kết quả gọi gộp nhiều mã (một `rN` chứa FPT, SHB, NVL): `chart_compare({from_calls: ["rN"]})` tự tách từng mã; vẽ một mã thì thêm `from_symbol: "SHB"`. Chỉ truyền số tay khi dữ liệu không đến từ tool.
2. **Chưa chắc chọn hình nào** thì đọc `references/choosing-a-form.md`, đi theo cây yes/no và DỪNG ở node ★ đầu tiên khớp. Chỉ đọc thêm file reference của đúng loại hình đó.
3. **Thiếu điểm tối thiểu** (ngưỡng ghi trong cây) thì báo thiếu dữ liệu, không vẽ.
4. **Nhận xét 2–3 câu** từ hình và số (xu hướng, đỉnh/đáy, vị trí trong biên độ, đơn vị). Hình tự hiện trong TUI: không chép hình vào câu trả lời.

## Lưu ý

- Giá nhiều mã dùng `chart_compare` (% thay đổi), không vẽ chung một `multiline`.
- Pie quá 7 lát thì dùng bar; một giá trị trên tổng thì dùng donut/gauge.
- Luôn truyền `unit` khi biết (kVND, %, tỷ, triệu cp).
- Mỗi câu trả lời tối đa 1 biểu đồ, trừ khi người dùng yêu cầu thêm.

## File tham khảo

| File | Dùng khi |
|---|---|
| `references/choosing-a-form.md` | Chọn loại hình theo dạng dữ liệu, và hình nên tránh |
| `references/time-series.md` | Nến + khối lượng, đường giá, area, sparkline |
| `references/comparison.md` | Bar, boxplot, histogram, so sánh % |
| `references/part-to-whole.md` | Pie/donut, stacked, waterfall |
| `references/relationship.md` | Scatter, multiline chỉ số, heatmap |
| `references/anti-patterns.md` | Những gì không nên vẽ |
