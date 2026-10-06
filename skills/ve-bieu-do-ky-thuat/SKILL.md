---
name: ve-bieu-do-ky-thuat
description: "Draw charts right in the TUI (candlestick, price line, sparkline, bar, gauge, heatmap, donut, histogram, multi-ticker compare, depth orderbook) with ANSI color. Always use this skill when the user says vẽ, chart, nến, candlestick or asks to see price bias visually — e.g. 'vẽ nến VCB', 'so chart VCB vs HPG' — even when the user doesn't explicitly say they want 'vẽ biểu đồ'."
activation: auto
requires_tools: [chart_render]
triggers:
  keywords: [vẽ, chart, nến, candlestick, đường giá, sparkline, biểu đồ, đồ thị, so sánh, bar, gauge, heatmap, donut, histogram, fear, greed, tương quan, tỷ trọng]
tool_budget: 8
version: 1.3.0
---

# Drawing Charts Inside the TUI

Pure display skill: data comes from data tools on every call, there are no fixed live numbers — never pass illustrative numbers off as real ones. Reuse data already in context; do not re-fetch.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user says vẽ, chart, nến, candlestick, price line, sparkline, compare 2–5 tickers, sector/top gainers-losers bar, fear/greed gauge, correlation heatmap, allocation donut, distribution histogram, depth orderbook.
- When NOT to use (use another skill instead): text-only analysis (use `ky-thuat-chuyen-sau` only); detailed valuation (use `dinh-gia-chuyen-sau` only).

## Lookup: Data Tool to Chart Kind

| Data (tool) | `chart_render` kind |
|---|---|
| OHLC candles: `vn_equity_ohlcv`, `market_candles_batch`, `dnse_ohlc_history` | `candlestick` (bars ≥5) |
| Price/macro series: `vn_quote_history`, `fred_series`, `vs_indicator_data`, `yf_alloc_history` | `line` / `sparkline` / `area` |
| Compare 2–5 tickers/assets: `compare_assets`, `compare_equities`, `vn_equity_quote_batch` | `chart_compare` (dedicated tool, legend + % from first point) |
| Top gainers/losers, sector, per/pb, odds, annual targets: `market_movers`, `sector_performance`, `valuation_run`, `world_prediction_odds`, `planned_targets` | `bar` (series + labels; green when ≥0, red when <0) |
| Distributions: `event_study` CARs, `pattern_match` corrs | `histogram` |
| Matrices: `correlation_matrix`, `compare_assets`, `vs_industry_heatmap` | `heatmap` (matrix + labels rows+cols) |
| Single number: `world_fear_greed`, `sentiment_score`, `quant_risk` | `gauge` (value+max) |
| Allocation weights: `portfolio_optimize`, `holders`, `breadth_scan` | `donut` (value+max) |
| Win/loss: `money_flow`, `vs_nn_flow` sign | `winloss` |
| Orderbook: `dnse_orderbook` | `chart_depth` |

## Workflow

Copy the checklist and tick as you progress:

```
Task Progress:
- [ ] Step 1: get data (reuse from context if available)
- [ ] Step 2: draw (correct kind + color)
- [ ] Step 3: 2-3 sentence verdict
```

**Step 1: Get data.**

Pick the data tool from the lookup table above. Choose the right source before drawing: VN ticker → `vn_equity_ohlcv`/`vn_quote_history` (NEVER use `vn_crypto_ohlcv` for stocks); USD crypto → `crypto_spot`. If data is missing, say so honestly; never draw without data. Minimum thresholds: candlestick ≥5 candles; line/sparkline/area/winloss ≥2 points; histogram ≥5 points; heatmap non-empty matrix; gauge/donut need value+max. Below threshold → do not draw, report missing data.

**Step 2: Draw.**

Run `chart_render` (+symbol) or `chart_compare`. ANSI color follows direction automatically (up green/down red); `color=never` when the user copies plain text. Default width 64 chars (never exceed 100 to avoid breaking TUI wrap); candle height 14, line 10, compact 1–8.

**Step 3: Verdict.**

Read from the picture + numbers: trend, HH/LL, price position vs range. 2–3 sentences, state units in kVND (57.3 = 57,300đ). Long charts auto-collapse after 3 lines (ctrl+o to expand) — do not summarize the picture in long prose. Outside DNSE hours an empty orderbook is expected; `chart_depth` reports empty, no retry.

## Template

ALWAYS use this output structure: the chart picture (keep ANSI chars intact) + 2–3 sentence verdict (trend, HH/LL, price position vs range, kVND units).

## Examples

**Example 1:**
Input: vẽ nến VCB 30 phiên
Output: 1 data call + 1 `chart_render` call + colored candle picture + verdict ≤3 sentences, ≤8 calls.
