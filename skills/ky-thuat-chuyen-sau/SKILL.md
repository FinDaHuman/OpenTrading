---
name: ky-thuat-chuyen-sau
description: Pure single-stock multi-timeframe technical read 1D/1W/1M (RSI/MACD/BB/Ichimoku/ADX, Elliott/Wyckoff, support-resistance, higher-high or lower-low). Always use this skill when the user asks about technicals, breakouts, reading the price band, Elliott waves or HH/LL of a stock — e.g. "VCB kỹ thuật sao", "FPT có breakout không" — even when the user doesn't say explicitly they want "phân tích kỹ thuật".
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
tool_budget: 8
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, hỗ trợ, kháng cự, breakout, pattern, orderbook, băng giá, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.3.0
---

# Reading Single-Stock Technicals

Default 2 timeframes (1D+1W); 1M only when the user asks long-term. One `signals_technical` call already covers 80% of the verdict — this is the model "1 pillar tool" skill, don't add more tools just for extra numbers. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks about 1 stock's technicals (`VCB kỹ thuật đa khung sao`, `FPT có breakout không`, `đọc băng HPG`, `higher-high hay lower-low`, `sóng Elliott`).
- When NOT to use (use a different skill instead):
  - Financial statements/fundamentals/M-Score → `co-ban-chuyen-sau`.
  - Valuation/fair value/PER/upside → `dinh-gia-chuyen-sau`.
  - Full single-stock analysis → `phan-tich-chuyen-sau-1-ma` (that skill dispatches this one).
  - Comparing multiple stocks → `so-sanh-cung-nganh`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: multi-timeframe candles (1 call per timeframe)
- [ ] Step 2: read wave structure from Step 1 output (no new tool calls)
- [ ] Step 3: confirm per the question (max 3 calls)
- [ ] Step 4: per-timeframe verdict + synthesis
```

**Step 1: Multi-timeframe candles.**

Run `signals_technical` (symbol, interval=1D) + (interval=1W) [+ (interval=1M) if long-term]. One call per timeframe: RSI/MACD/BB/Ichimoku/S-R/patterns. Interval only accepts 1D/1W/1M (1W needs ≥30 bars, 1M ≥24 bars); unknown interval → `unavailable`, no retry.

**Step 2: Read wave structure (no new tool calls).**

From the Step 1 output read swings + swing_trend + fib + elliott + wyckoff; label yourself HH/HL/LH/LL + 7 Fibonacci levels + Elliott (impulse/corrective/developing + invalidation) + Wyckoff phase.

**Step 3: Confirm per the question (max 3 calls).**

Only call when the user asks about: `pattern_match` (historical analogy) · `dnse_latest_trade` / `dnse_orderbook` / `vn_trades` (intraday) · `vn_index_ohlcv` (index trend). Do NOT call `financial_detail` / `valuation_run` / `stock_forensic` here.

**Step 4: Validate before finalizing.**

New stock <60 candles → indicators null → report "thiếu lịch sử", never fabricate RSI/MACD. DNSE session ended → empty orderbook is correct data, state the closed session. `pattern_match` corr <0.4 = no reliable analogy → report it honestly. Prices come as kVND (`signals_technical.last 57.3` = 57,300đ) → conversion mandatory + state the unit. Any missing timeframe → partial verdict for the remaining timeframes + note which are missing. Elliott/Wyckoff are heuristics → confidence + invalidation mandatory.

## Template

ALWAYS use this exact verdict structure, for EACH timeframe (1D/1W[/1M]), every item with numbers + trend + provenance:

1. Trend: SMA stack + ADX. 2. Momentum: RSI/MACD/stoch/CCI per indicator. 3. S-R of that timeframe. 4. Structure: HH/HL/LH/LL + Fibo + Elliott pattern/invalidation + Wyckoff phase + confidence. 5. Timeframe conclusion: higher-high or lower-low. 6. Synthesis: multi-timeframe consensus or divergence + price trigger → timing MUA/CHỜ/BÁN. 7. One-sentence conclusion for the whole stock.

## Examples

**Example 1 (live 02-10-2026, no new fabricated numbers):**
Input: FPT kỹ thuật 1D+1W
Output: VCB — RSI 39.2, ADX 12.1 (trend yếu), MACD −0.31/−0.13, EMA10 58.09, pos_52w 0.21 · HPG pattern best_corr 0.409 (yếu — state honestly) · VCB 1W bearish/lower-low/fib-down consistent → 2-timeframe verdict + HH/LL + Ichimoku signal, ≤8 calls.
