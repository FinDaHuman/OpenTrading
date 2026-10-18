---
name: ky-thuat-chuyen-sau
description: "Đọc kỹ thuật một mã đa khung 1D/1W/1M (RSI, MACD, Bollinger, Ichimoku, ADX, hỗ trợ/kháng cự, breakout). Dùng khi hỏi kỹ thuật hay xu hướng giá của một mã."
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, vùng hỗ trợ, kháng cự, breakout, pattern, orderbook, đọc băng, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.4.0
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

## Ngôn ngữ trình bày

Ký hiệu trong cấu trúc trên dùng để bạn đọc kết quả tool. Giữ nguyên 7 mục khi viết ra, nhưng chữ bên trong mục thì dịch sang lời thường:

| Ký hiệu khi đọc tool | Viết cho người dùng |
| --- | --- |
| HH/HL/LH/LL, higher-high, lower-low | đỉnh cao dần / đáy cao dần / đỉnh thấp dần / đáy thấp dần |
| S-R, support/resistance | vùng hỗ trợ – kháng cự |
| SMA stack, SMA20 | cụm đường trung bình động, trung bình động 20 phiên (SMA20) |
| ADX | sức mạnh xu hướng (ADX) |
| BB, Bollinger band | dải Bollinger |
| MACD line/signal/hist | đường MACD, đường tín hiệu, thanh lịch sử MACD |
| Fibo, Elliott, Wyckoff, invalidation, confidence | nhịp theo số Fibonacci, sóng Elliott, tích lũy Wyckoff, điều kiện phủ định luận điểm, độ tin cậy |
| momentum, sideway, trigger | động lượng, đi ngang, mức giá kích hoạt |
| 1D/1W/1M | khung ngày/tuần/tháng |

Tên chỉ báo viết tắt quen thuộc (RSI, MACD, ADX, SMA20) thì giữ nguyên, chú giải một câu ngắn lần đầu: "RSI (thang đo sức mua bán của 14 phiên gần nhất)". Tên mô hình lạ (Wyckoff, Elliott) chỉ nêu khi kèm một câu nói nó đang chỉ cái gì; không thì bỏ — kết luận đứng được mà không cần tên đó.

## Ví dụ

**Ví dụ 1:**
Hỏi: FPT kỹ thuật 1D+1W
Đạt khi: verdict 2 khung + HH/LL + Ichimoku signal, ≤8 calls, và trong câu trả lời không còn nhãn kỹ thuật tiếng Anh nào chưa dịch.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: candlestick+volume, multiline chỉ số, depth orderbook.
