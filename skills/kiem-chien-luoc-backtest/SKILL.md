---
name: kiem-chien-luoc-backtest
description: Verify trading strategies with backtest code (SMA cross, RSI oversold, momentum, param sweep with best AND worst, monthly seasonality, post-Tết/dividend, oil/gold price rules). Always use this skill when the user asks whether a strategy works or which month/quarter tends to rise — e.g. "SMA20/50 FPT có ăn không", "mua RSI<30 có thắng không" — even when the user doesn't explicitly say they want a "backtest".
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
tool_budget: 12
triggers:
  keywords: [backtest, kiểm chứng, chiến lược, sma cross, rsi dưới, quá bán, momentum chiến lược, param sweep, mùa vụ tháng, sau tết, sau chia cổ tức, theo giá dầu, theo giá vàng]
version: 1.3.0
---

# Backtesting Trading Strategies Honestly

Standard pipeline per run: baseline → strategy → sweep → seasonality/event → conclusion. Best must always come with worst (anti-overfit); missing worst or missing engine caveat means not done. Engine is numpy-only, default cost, VN T+2 not modeled — every conclusion carries this caveat. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: verifying technical conditions (SMA/momentum/RSI), time conditions (month/quarter), post-event conditions (Tết/dividend/AGM), commodity-price conditions (oil/gold).
- When NOT to use (use another skill instead): specific position sizing → the Đệm (cushion) leg in `danh-gia-truoc-bctc`; valuation → `dinh-gia-chuyen-sau`; news/sentiment → `tim-kiem-tin-tuc` / `phan-tich-sentiment`.

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: data + benchmark (1 symbol at a time)
- [ ] Step 2: technical conditions
- [ ] Step 3: time conditions
- [ ] Step 4: post-event conditions
- [ ] Step 5: commodity-price conditions
- [ ] Step 6: sweep + best/worst synthesis
```

**Step 1: Data (first, sequential).**

Run `vn_quote_history` (stock) or `dnse_ohlc_history` (futures/index) + `vn_index_ohlcv` (benchmark). Only 1 symbol per sweep. For VN stocks use equity candles — NEVER use `vn_crypto_ohlcv`.

**Step 2: Technical conditions.**

Run `backtest_strategies` (strategy=sma_cross/momentum/**rsi_meanrev** + rsi_low/rsi_high). rsi_meanrev: buy RSI<30, exit RSI>70. `quant_backtest` is deprecated for strategies (baseline buy-hold only) — all timing-rule comparisons go through `backtest_strategies`; never call `quant_backtest` in this step.

**Step 3: Time conditions.**

Run `backtest_strategies` + `months`/`quarters` + `seasonality` (describes month/quarter). Entries only in the selected periods, exits always open. Months=[1] on a March candle → 0 trades + warning is valid, no retry with a different timeframe.

**Step 4: Post-event conditions.**

Run `event_study` (symbol, dates, window ±N) — CAR around Tết/dividend/AGM, dates from `event_calendar_vn`, nearest-day 3 sessions, with hit-rate/best-worst.

**Step 5: Commodity-price conditions.**

Run `backtest_strategies` + `condition_symbol` (BZ=F/GC=F...) + `condition_rule` above_sma/rising. If `condition_symbol` is down the whole call is unavailable — say so clearly, never substitute another symbol. The vnstock→yfinance fallback is inside the tool; never switch sources manually.

**Step 6: Synthesis.**

Run `param_sweep` (max 30 available combos, never widen it yourself; passthrough months/quarters) + `correlation_matrix` + `portfolio_optimize` (multiple stocks). Never sweep more than 3 symbols per run.

## Template

ALWAYS use this exact verdict structure: baseline buy-hold → each condition (trades/net/win) → best param + worst param → seasonality/event bias → verdict "đáng tin / đáng nghi" (trustworthy / questionable) + reason + engine caveat (numpy-only, default cost, T+2 not modeled) + provenance (candle source, benchmark, event dates).

## Examples

**Example 1 (live 02-10-2026, no fabricated numbers):**
Input: Backtest mua RSI<30 FPT + backtest sau Tết
Output: VCB buy-hold −4.9% gross · sma_cross 7 trades −10.4% · sweep best **+3.7%** · seasonality January mean +4.67% · rsi_meanrev VCB 1 trade · months=[1] on a March candle → 0 trades + warning · event_study VCB 2026-09-21: CAR +0.25% → table of each condition (trades/net/win) + best/worst + verdict, with T+2/cost caveat.
