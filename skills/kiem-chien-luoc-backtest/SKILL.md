---
name: kiem-chien-luoc-backtest
description: "Tests a strategy by backtest (SMA cross, RSI, momentum, seasonality, following oil/gold), reporting both the best and the worst results. Use when asked whether a strategy works."
match_text: "Kiểm chứng chiến lược bằng backtest (SMA cross, RSI, momentum, mùa vụ, theo dầu/vàng), báo cả kết quả tốt nhất và tệ nhất. Dùng khi hỏi chiến lược có hiệu quả không."
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
triggers:
  keywords: [backtest, kiểm chứng chiến lược, chiến lược giao dịch, sma cross, rsi dưới, quá bán, momentum chiến lược, param sweep, mùa vụ tháng, sau tết, sau chia cổ tức, theo giá dầu, theo giá vàng]
version: 1.3.0
---

# Backtest chiến lược giao dịch

The standard pipeline per run: baseline → strategy → sweep → seasonality/event → conclusion. The best result must come with the worst (against overfitting); missing the worst or the engine caveat → not met. The engine is numpy-only, with default costs, and Vietnam's T+2 is not modelled — every conclusion carries this caveat.

## Khi nào dùng

- Use when: testing technical conditions (SMA/momentum/RSI), timing (month/quarter), post-event behaviour (Tết/dividends/AGMs), conditions on commodity prices (oil/gold).
- Do NOT use (use another skill instead): sizing a specific position → the cushion leg in `danh-gia-truoc-bctc`; valuation → `dinh-gia-chuyen-sau`; news/sentiment → `tim-kiem-tin-tuc` / `phan-tich-sentiment`.

## Các bước

**Bước 1: Data (first, sequential).**

Run `vn_quote_history` (stocks) or `dnse_ohlc_history` (futures/index) + `vn_index_ohlcv` (benchmark). Only 1 symbol per sweep. For Vietnamese stock tickers use equity candles — NEVER `vn_crypto_ohlcv`.

**Bước 2: Technical conditions.**

Run `backtest_strategies` (strategy=sma_cross/momentum/**rsi_meanrev** + rsi_low/rsi_high). rsi_meanrev: buy at RSI<30, exit at RSI>70. `quant_backtest` is deprecated for strategies (baseline buy-hold only) — every timing-rule comparison goes through `backtest_strategies`; do not call `quant_backtest` in this step.

**Bước 3: Timing conditions.**

Run `backtest_strategies` + `months`/`quarters` + `seasonality` (month/quarter description). Entries only in the chosen periods, exits always open. Months=[1] on monthly candles giving 0 trades + a warning is valid; do not retry with another timeframe.

**Bước 4: Post-event conditions.**

Run `event_study` (symbol, dates, window ±N) — CAR around Tết/dividends/AGMs, dates from `event_calendar_vn`, nearest day within 3 sessions, with hit rate/best-worst.

**Bước 5: Commodity-price conditions.**

Run `backtest_strategies` + `condition_symbol` (BZ=F/GC=F...) + `condition_rule` above_sma/rising. If `condition_symbol` is down, the whole call is unavailable — say so; do not swap in another symbol. The vnstock→yfinance fallback lives inside the tool; never switch sources by hand.

**Bước 6: Synthesis.**

Run `param_sweep` (at most the 30 built-in combos, never widened; passes months/quarters through) + `correlation_matrix` + `portfolio_optimize` (several tickers). Never sweep more than 3 symbols per run.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure: buy-and-hold as the benchmark → each condition (number of trades, net return, win rate) → best + worst configuration → seasonality/event effects → a conclusion "đáng tin / đáng nghi + lý do" + the test's limits (T+2 not modelled, the assumed trading cost) + sources (candle source, benchmark, event dates).

Table labels in Vietnamese: "số lệnh" (not "trades"), "lợi nhuận ròng" (not "net return"), "tỷ lệ lệnh thắng" (not "win rate"), "mức sụt giảm sâu nhất" (not "max drawdown"), "chiến lược mua và nắm giữ" (not "buy & hold"). Write a "10 bps" cost as "10 điểm cơ bản (0,1%)" — 1 bps is 0.01%, not 1 percentage point. Say "whipsaw" and "overfit" in plain words: "đảo chiều liên tục trong giao dịch", "học kỹ quá khứ".

## Ví dụ

**Ví dụ 1:**
Hỏi: Backtest mua RSI<30 FPT + backtest sau Tết
Đạt khi: a table per condition (trades/net/win) + best/worst + a conclusion, with the T+2/cost caveat.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar diverging best/worst, line CAR path, bar/heatmap seasonality, heatmap correlation.
