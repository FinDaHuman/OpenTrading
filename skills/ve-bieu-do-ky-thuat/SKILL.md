---
name: ve-bieu-do-ky-thuat
description: "Vẽ biểu đồ ngay trong TUI (nến, đường giá, sparkline, bar, gauge, heatmap, donut, histogram, so sánh nhiều mã, depth orderbook) có màu ANSI. Luôn dùng skill này khi user nói vẽ, chart, nến, candlestick hay xin xem bias giá bằng hình — ví dụ 'vẽ nến VCB', 'so chart VCB vs HPG' — ngay cả khi user không nói rõ muốn 'vẽ biểu đồ'."
activation: auto
requires_tools: [chart_render]
triggers:
  keywords: [vẽ, chart, nến, candlestick, đường giá, sparkline, biểu đồ, đồ thị, so sánh, bar, gauge, heatmap, donut, histogram, fear, greed, tương quan, tỷ trọng]
tool_budget: 8
version: 1.2.1
---

# Drawing Charts Inside the TUI

Skill thuần hiển thị: số liệu lấy từ tool dữ liệu mỗi lần gọi, không có số live cố định — không bịa số minh họa thành số thật. Dùng lại dữ liệu đã có trong context, không fetch lại.

## When to Use

- Dùng khi: user nói vẽ, chart, nến, candlestick, đường giá, sparkline, so sánh 2–5 mã, bar ngành/top tăng giảm, gauge fear/greed, heatmap tương quan, donut tỷ trọng, histogram phân phối, depth orderbook.
- Khi KHÔNG dùng (dùng skill khác thay thế): phân tích chữ thuần (chỉ dùng `ky-thuat-chuyen-sau`); định giá chi tiết (chỉ dùng `dinh-gia-chuyen-sau`).

## Lookup: Data Tool to Chart Kind

| Dữ liệu (tool) | `chart_render` kind |
|---|---|
| Nến OHLC: `vn_equity_ohlcv`, `market_candles_batch`, `dnse_ohlc_history` | `candlestick` (bars ≥5) |
| Chuỗi giá/macro: `vn_quote_history`, `fred_series`, `vs_indicator_data`, `yf_alloc_history` | `line` / `sparkline` / `area` |
| So 2–5 mã/tài sản: `compare_assets`, `compare_equities`, `vn_equity_quote_batch` | `chart_compare` (tool riêng, legend + % từ điểm đầu) |
| Top tăng/giảm, ngành, per/pb, odds, KH năm: `market_movers`, `sector_performance`, `valuation_run`, `world_prediction_odds`, `planned_targets` | `bar` (series + labels; xanh khi ≥0, đỏ khi <0) |
| Phân phối: `event_study` CARs, `pattern_match` corrs | `histogram` |
| Ma trận: `correlation_matrix`, `compare_assets`, `vs_industry_heatmap` | `heatmap` (matrix + labels rows+cols) |
| 1 số: `world_fear_greed`, `sentiment_score`, `quant_risk` | `gauge` (value+max) |
| Tỷ trọng: `portfolio_optimize`, `holders`, `breadth_scan` | `donut` (value+max) |
| Thắng/thua: `money_flow`, `vs_nn_flow` sign | `winloss` |
| Orderbook: `dnse_orderbook` | `chart_depth` |

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: lấy dữ liệu (dùng lại trong context nếu có)
- [ ] Step 2: vẽ (đúng kind + màu)
- [ ] Step 3: verdict 2-3 câu
```

**Step 1: Lấy dữ liệu.**

Lấy tool dữ liệu theo bảng tra trên. Chọn nguồn đúng trước khi vẽ: mã VN → `vn_equity_ohlcv`/`vn_quote_history` (KHÔNG dùng `vn_crypto_ohlcv` cho cổ phiếu); crypto USD → `crypto_spot`. Thiếu thì báo trung thực, không vẽ chay. Ngưỡng tối thiểu: candlestick ≥5 nến; line/sparkline/area/winloss ≥2 điểm; histogram ≥5 điểm; heatmap matrix phi rỗng; gauge/donut cần value+max. Chưa đủ thì không vẽ, báo thiếu data.

**Step 2: Vẽ.**

Chạy `chart_render` (+symbol) hoặc `chart_compare`. Màu ANSI tự theo chiều (tăng xanh/giảm đỏ); `color=never` khi user copy text thuần. Rộng mặc định 64 ký tự (không vượt 100 để khỏi vỡ wrap TUI); cao nến 14, line 10, compact 1–8.

**Step 3: Verdict.**

Đọc từ hình + số: trend, HH/LL, vị trí giá vs range. 2–3 câu, ghi đơn vị kVND (57.3 = 57,300đ). Chart dài tự collapse sau 3 dòng (ctrl+o mở rộng) — không tóm tắt hình bằng lời dài. Ngoài giờ DNSE thì orderbook rỗng là đúng, `chart_depth` báo rỗng, không retry.

## Template

ALWAYS use this output structure: hình chart (giữ nguyên ký tự ANSI) + verdict 2–3 câu (trend, HH/LL, vị trí giá vs range, đơn vị kVND).

## Examples

**Example 1:**
Input: vẽ nến VCB 30 phiên
Output: 1 call data + 1 call `chart_render` + hình nến màu + verdict ≤3 câu, ≤8 calls.
