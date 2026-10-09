---
name: ky-thuat-chuyen-sau
description: "Đọc kỹ thuật một mã đa khung 1D/1W/1M (RSI, MACD, Bollinger, Ichimoku, ADX, hỗ trợ/kháng cự, breakout). Dùng khi hỏi kỹ thuật hay xu hướng giá của một mã."
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, vùng hỗ trợ, kháng cự, breakout, pattern, orderbook, băng giá, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.3.0
---

# Phân tích kỹ thuật một mã

Mặc định 2 khung (1D+1W); khung 1M chỉ khi user hỏi dài hạn. Một call `signals_technical` đã đủ 80% verdict — đây là skill "1 tool trụ cột" mẫu mực, đừng gọi thêm tool cho đủ số.

## Khi nào dùng

- Dùng khi: user hỏi kỹ thuật 1 mã (`VCB kỹ thuật đa khung sao`, `FPT có breakout không`, `đọc băng HPG`, `higher-high hay lower-low`, `sóng Elliott`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi BCTC/cơ bản/M-Score → `co-ban-chuyen-sau`.
  - Hỏi định giá/fair value/PER/upside → `dinh-gia-chuyen-sau`.
  - Phân tích toàn diện 1 mã → `phan-tich-chuyen-sau-1-ma` (skill đó sẽ dispatch skill này).
  - So sánh nhiều mã → `so-sanh-cung-nganh`.

## Các bước

**Bước 1: Nến đa khung.**

Chạy `signals_technical` (symbol, interval=1D) + (interval=1W) [+ (interval=1M) nếu hỏi dài hạn]. Mỗi khung 1 call: RSI/MACD/BB/Ichimoku/S-R/patterns. Interval chỉ nhận 1D/1W/1M (1W cần ≥30 bars, 1M ≥24 bars); interval lạ → `unavailable`, không retry.

**Bước 2: Đọc cấu trúc sóng (không gọi tool mới).**

Từ output Bước 1 đọc swings + swing_trend + fib + elliott + wyckoff; tự dán nhãn HH/HL/LH/LL + Fibonacci 7 mức + Elliott (impulse/corrective/developing + invalidation) + Wyckoff phase.

**Bước 3: Xác nhận theo câu hỏi (tối đa 3 calls).**

Chỉ gọi khi user hỏi tới: `pattern_match` (analogy lịch sử) · `dnse_latest_trade` / `dnse_orderbook` / `vn_trades` (intraday) · `vn_index_ohlcv` (trend index). Không gọi `financial_detail` / `valuation_run` / `stock_forensic` ở đây.

**Bước 4: Validate trước khi chốt.**

Mã mới <60 nến → indicators null → báo "thiếu lịch sử", không bịa RSI/MACD. DNSE hết giờ → orderbook rỗng là đúng data, ghi rõ phiên đóng. `pattern_match` corr <0.4 = không có analogy đáng tin → ghi đúng. Giá theo kVND (`signals_technical.last 57.3` = 57,300đ) → bắt buộc qui đổi + ghi đơn vị. Khung nào thiếu → verdict partial khung còn lại + ghi khung thiếu. Elliott/Wyckoff là heuristic → bắt buộc ghi confidence + invalidation.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, cho MỖI khung (1D/1W[/1M]), mỗi mục ghi số + trend + provenance:

1. Trend: SMA stack + ADX. 2. Momentum: RSI/MACD/stoch/CCI cụ thể từng chỉ báo. 3. S-R của khung đó. 4. Cấu trúc: HH/HL/LH/LL + Fibo + Elliott pattern/invalidation + Wyckoff phase + confidence. 5. Kết luận khung: higher-high hay lower-low. 6. Tổng hợp: đồng thuận đa khung hay phân kỳ + trigger giá → timing MUA/CHỜ/BÁN. 7. Kết luận 1 câu chốt toàn mã.

## Ví dụ

**Ví dụ 1:**
Hỏi: FPT kỹ thuật 1D+1W
Trả lời: VCB — RSI <số>, ADX <số> (trend yếu), MACD <số>/<số>, EMA10 <số>, pos_52w <số> · HPG pattern best_corr <số> (yếu — ghi đúng) · VCB 1W bearish/lower-low/fib-down nhất quán → verdict 2 khung + HH/LL + Ichimoku signal, ≤8 calls.

## Trực quan hóa

Dữ liệu skill này nhận: chuỗi OHLC/giá, RSI/MACD/Stoch theo khung giờ, sổ lệnh bid/ask. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (candlestick+volume, multiline chỉ số, depth orderbook), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
