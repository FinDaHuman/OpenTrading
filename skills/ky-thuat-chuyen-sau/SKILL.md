---
name: ky-thuat-chuyen-sau
description: Phân tích THUẦN kỹ thuật 1 mã đa khung (1D/1W/1M) — RSI/MACD/BB/Ichimoku, Elliott/Wyckoff, hỗ trợ-kháng cự, higher-high hay lower-low.
when_to_use: "VCB kỹ thuật đa khung sao, FPT có breakout không, đọc băng HPG, higher-high hay lower-low, sóng Elliott. Không dùng khi: cơ bản (co-ban-chuyen-sau), định giá (dinh-gia-chuyen-sau)."
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
tool_budget: 8
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, hỗ trợ, kháng cự, breakout, pattern, orderbook, băng giá, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.1.0
---

# Kỹ thuật chuyên sâu 1 mã (đa khung)

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1. Nến đa khung | `signals_technical`(symbol, interval=1D) · (interval=1W) · [1M nếu hỏi dài hạn] | mỗi khung 1 call: RSI/MACD/BB/Ichimoku/S-R/patterns |
| 2. Cấu trúc sóng | đọc từ output wave 1: swings + swing_trend + fib + elliott + wyckoff | nhãn HH/HL/LH/LL + Fibonacci 7 mức + Elliott (impulse/corrective/developing + invalidation) + Wyckoff phase |
| 3. Xác nhận (chọn) | `pattern_match`(analogy lịch sử) · `dnse_latest_trade`/`dnse_orderbook`/`vn_trades` (intraday) · `vn_index_ohlcv` (trend index) | ≤3, theo câu hỏi |

## Verdict mỗi khung (1D/1W[/1M])

Trend (SMA stack + ADX) · momentum (RSI/MACD/BB/Ichimoku) · S-R của khung · cấu trúc
(HH/HL/LH/LL + Fibo) · Elliott pattern/invalidation + Wyckoff phase · **kết luận higher-high
hay lower-low**. Tổng hợp: đồng thuận đa khung hay phân kỳ + trigger giá → timing MUA/CHỜ/BÁN.

## Chống tràn lan

- `interval` chấp nhận 1D/1W/1M (1W ≥30 bars, 1M ≥24 bars); interval lạ → unavailable, đừng retry.
- Elliott/Wyckoff là heuristic (kèm confidence) — verdict ghi confidence + invalidation, không diễn giải sóng chuẩn bằng lời suông.

## Lỗi thường gặp

Mã mới <60 nến → indicators null, báo "thiếu lịch sử". DNSE hết giờ → orderbook rỗng là
đúng. `pattern_match` corr <0.4 = không có analogy đáng tin. Giá theo kVND
(`signals_technical.last 57.3` = 57,300đ) — qui đổi + ghi đơn vị.

## Bằng chứng live (02-10-2026)

VCB — RSI 39.2, ADX 12.1 (trend yếu), MACD −0.31/−0.13, EMA10 58.09, pos_52w 0.21 ·
HPG pattern best_corr 0.409 (yếu — ghi đúng) · VCB 1W bearish/lower-low/fib-down nhất quán.

## Nghiệm thu

"FPT kỹ thuật 1D+1W" → verdict 2 khung + HH/LL + Ichimoku signal, ≤8 calls.
