---
name: ky-thuat-chuyen-sau
description: "Reads one ticker's technicals across 1D/1W/1M (RSI, MACD, Bollinger, Ichimoku, ADX, support/resistance, breakout). Use for a ticker's technicals or price trend."
match_text: "Đọc kỹ thuật một mã đa khung 1D/1W/1M (RSI, MACD, Bollinger, Ichimoku, ADX, hỗ trợ/kháng cự, breakout). Dùng khi hỏi kỹ thuật hay xu hướng giá của một mã."
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, vùng hỗ trợ, kháng cự, breakout, pattern, orderbook, đọc băng, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.4.0
---

# Phân tích kỹ thuật một mã

Default to 2 timeframes (1D+1W); the 1M timeframe only when the user asks about the long term. One `signals_technical` call already gives 80% of the verdict — this is a model "one pillar tool" skill; do not call extra tools to pad the count.

## Khi nào dùng

- Use when: the user asks about one ticker's technicals (`VCB kỹ thuật đa khung sao`, `FPT có breakout không`, `đọc băng HPG`, `higher-high hay lower-low`, `sóng Elliott`).
- Do NOT use (use another skill instead):
  - Financial statements/fundamentals/M-Score → `co-ban-chuyen-sau`.
  - Valuation/fair value/PER/upside → `dinh-gia-chuyen-sau`.
  - A full analysis of one ticker → `phan-tich-chuyen-sau-1-ma` (that skill dispatches this one).
  - Comparing several tickers → `so-sanh-cung-nganh`.

## Các bước

**Bước 1: Multi-timeframe candles.**

Run `signals_technical` (symbol, interval=1D) + (interval=1W) [+ (interval=1M) for long-term questions]. One call per timeframe: RSI/MACD/BB/Ichimoku/S-R/patterns. interval accepts only 1D/1W/1M (1W needs ≥30 bars, 1M ≥24 bars); an unknown interval → `unavailable`, no retry.

**Bước 2: Read the wave structure (no new tool calls).**

From the Bước 1 output read swings + swing_trend + fib + elliott + wyckoff; label HH/HL/LH/LL yourself + the 7 Fibonacci levels + Elliott (impulse/corrective/developing + invalidation) + the Wyckoff phase.

**Bước 3: Confirm per the question (at most 3 calls).**

Call only when the user asks: `pattern_match` (historical analogy) · `dnse_latest_trade` / `dnse_orderbook` / `vn_trades` (intraday) · `vn_index_ohlcv` (index trend). Do not call `financial_detail` / `valuation_run` / `stock_forensic` here.

**Bước 4: Validate before concluding.**

A new ticker with <60 candles → null indicators → report "thiếu lịch sử"; never invent RSI/MACD. DNSE after hours → an empty order book is correct data; say the session is closed. `pattern_match` corr <0.4 = no trustworthy analogy → say so. Prices are in kVND (`signals_technical.last 57.3` = 57,300đ) → you must convert + state the unit. A missing timeframe → a partial verdict on the remaining ones + name the missing one. Elliott/Wyckoff are heuristics → you must state confidence + invalidation.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, for EACH timeframe (1D/1W[/1M]), each item with figures + trend + provenance:

1. Trend: SMA stack + ADX. 2. Momentum: RSI/MACD/stoch/CCI, each indicator specifically. 3. That timeframe's S-R. 4. Structure: HH/HL/LH/LL + Fibo + Elliott pattern/invalidation + Wyckoff phase + confidence. 5. Timeframe conclusion: higher-high or lower-low. 6. Synthesis: multi-timeframe agreement or divergence → scenarios (tích cực / cơ sở / tiêu cực), each with the price behaviour that would confirm it and the one that would invalidate it (e.g. a close above or below a support–resistance zone), and a likelihood (cao / trung bình / thấp) with the reason. A confirming or invalidating level may be given as an entry, exit or stop-loss level with the scenario it belongs to. 7. A 1-sentence conclusion for the whole ticker: the most likely scenario and a buy/wait/sell call with its levels.

## Ngôn ngữ trình bày

The notation in the structure above is for you to read tool results. Keep all 7 items when writing, but render the words inside them in plain language:

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

Keep familiar indicator abbreviations (RSI, MACD, ADX, SMA20), with a short gloss the first time: "RSI (thang đo sức mua bán của 14 phiên gần nhất)". Mention unfamiliar model names (Wyckoff, Elliott) only with a sentence saying what they indicate; otherwise drop them — the conclusion stands without the name.

## Ví dụ

**Ví dụ 1:**
Hỏi: FPT kỹ thuật 1D+1W
Đạt khi: a 2-timeframe verdict + HH/LL + the Ichimoku signal, ≤8 calls, and no untranslated English technical label left in the answer.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: candlestick+volume, multiline indices, depth orderbook.
