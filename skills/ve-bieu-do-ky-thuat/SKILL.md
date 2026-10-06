---
name: ve-bieu-do-ky-thuat
description: "Vẽ biểu đồ dạng text trong terminal (nến, đường giá, cột, gauge, heatmap, so sánh nhiều mã, sổ lệnh) từ dữ liệu tool. Dùng khi người dùng muốn xem biểu đồ."
activation: auto
requires_tools: [chart_render, chart_compare, chart_depth]
triggers:
  keywords: [vẽ biểu đồ, vẽ chart, vẽ nến, biểu đồ, đồ thị, biểu đồ nến, chart, candlestick, sparkline, heatmap, gauge, donut, histogram]
version: 1.3.0
---

# Vẽ biểu đồ trong terminal

Skill thuần hiển thị: số liệu lấy từ tool dữ liệu mỗi lần gọi, không có số live cố định — không bịa số minh họa thành số thật. Dùng lại dữ liệu đã có trong context, không fetch lại.

## Khi nào dùng

- Dùng khi: user nói vẽ, chart, nến, candlestick, đường giá, sparkline, so sánh 2–5 mã, bar ngành/top tăng giảm, gauge fear/greed, heatmap tương quan, donut tỷ trọng, histogram phân phối, depth orderbook.
- Khi KHÔNG dùng (dùng skill khác thay thế): phân tích chữ thuần (chỉ dùng `ky-thuat-chuyen-sau`); định giá chi tiết (chỉ dùng `dinh-gia-chuyen-sau`).

## Tra cứu: tool dữ liệu → loại biểu đồ

| Dữ liệu (tool) | `chart_render` kind |
|---|---|
| Nến OHLC: `vn_equity_ohlcv`, `market_candles_batch`, `dnse_ohlc_history` | `candlestick` (bars ≥5) |
| Chuỗi giá/macro: `vn_quote_history`, `fred_series`, `vs_indicator_data`, `yf_alloc_history` | `line` / `sparkline` / `area` |
| So 2–5 mã/tài sản: `compare_assets`, `compare_equities`, `vn_equity_quote_batch` | `chart_compare` (tool riêng: mỗi chuỗi một dòng, % từ điểm đầu, cùng thang) |
| Top tăng/giảm, ngành, per/pb, odds, KH năm: `market_movers`, `sector_performance`, `valuation_run`, `world_prediction_odds`, `planned_targets` | `bar` (series + labels; █ dương, ░ âm) |
| Phân phối: `event_study` CARs, `pattern_match` corrs | `histogram` |
| Ma trận: `correlation_matrix`, `compare_assets`, `vs_industry_heatmap` | `heatmap` (matrix + labels rows+cols) |
| 1 số: `world_fear_greed`, `sentiment_score`, `quant_risk` | `gauge` (value+max) |
| Tỷ trọng: `portfolio_optimize`, `holders`, `breadth_scan` | `donut` (value+max) |
| Thắng/thua: `money_flow`, `vs_nn_flow` sign | `winloss` |
| Orderbook: `dnse_orderbook` | `chart_depth` |

## Các bước

**Bước 1: Lấy dữ liệu.**

Lấy tool dữ liệu theo bảng tra trên. Chọn nguồn đúng trước khi vẽ: mã VN → `vn_equity_ohlcv`/`vn_quote_history` (KHÔNG dùng `vn_crypto_ohlcv` cho cổ phiếu); crypto USD → `crypto_spot`. Thiếu thì báo trung thực, không vẽ chay. Ngưỡng tối thiểu: candlestick ≥5 nến; line/sparkline/area/winloss ≥2 điểm; histogram ≥5 điểm; heatmap matrix phi rỗng; gauge/donut cần value+max. Chưa đủ thì không vẽ, báo thiếu data.

**Bước 2: Vẽ.**

Chạy `chart_render` (+symbol) hoặc `chart_compare`. Kết quả là text thuần, không màu. Rộng mặc định 64 ký tự (tối đa 120); cao nến 14, line 10.

**Bước 3: Verdict.**

Đọc từ hình + số: trend, HH/LL, vị trí giá vs range. 2–3 câu, ghi đơn vị kVND (57.3 = 57,300đ). Kết quả tool chỉ hiện vài dòng đầu trong giao diện, nên muốn người dùng thấy hình thì chép nguyên văn hình vào câu trả lời, đặt trong khối code ``` để không bị hiểu thành markdown. Không tóm tắt hình bằng lời dài. Ngoài giờ DNSE thì orderbook rỗng là đúng, `chart_depth` báo rỗng, không retry.

## Cấu trúc câu trả lời

Trình bày theo thứ tự: hình chart trong khối code ``` (chép nguyên văn từ kết quả tool) + nhận định 2–3 câu (trend, HH/LL, vị trí giá trong biên độ, đơn vị kVND).

## Ví dụ

**Ví dụ 1:**
Hỏi: vẽ nến VCB 30 phiên
Trả lời: 1 lần gọi tool dữ liệu + 1 lần `chart_render`, hình nến trong khối code, nhận định ≤3 câu.
