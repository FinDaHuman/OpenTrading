---
name: kiem-chien-luoc-backtest
description: Kiểm chứng chiến lược/backtest — baseline, best param KÈM worst param, seasonality, verdict đáng tin.
when_to_use: "SMA20/50 FPT có ăn không, mùa vụ tháng mấy, backtest VN30F1M. Không dùng khi: rủi ro vị thế cụ thể (kiem-tra-rui-ro-vi-the)."
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
tool_budget: 12
triggers:
  keywords: [backtest, kiểm chứng, chiến lược, sma cross, momentum chiến lược, param sweep, mùa vụ tháng]
version: 1.0.0
---

# Kiểm chứng chiến lược (backtest)

## Workflow

| Wave | Tools |
|---|---|
| 1 | `vn_quote_history`(stock) hoặc `dnse_ohlc_history`(futures/index) · `vn_index_ohlcv`(benchmark) |
| 2 | `quant_backtest`(baseline buy-hold) · `quant_factors` |
| 3 | `backtest_strategies`(sma/momentum) · `param_sweep`(fast×slow ≤30 combos) |
| 4 | `seasonality` · `correlation_matrix` · `portfolio_optimize`(nếu nhiều mã) · `pattern_match` |

## Verdict

Baseline → chiến lược → best param **KÈM worst param** (chống overfit) → seasonality bias →
kết luận "đáng tin / đáng nghi + lý do". Ghi rõ engine: numpy-only, cost mặc định, T+2 VN
chưa model trong backtest.

## Chống tràn lan

- 1 symbol mỗi lần sweep; `param_sweep` cap 30 combos có sẵn — không tự nới; không sweep >3 symbol/run.

## Bằng chứng live (02-10-2026)

VCB buy-hold −4.9% gross · sma_cross HPG-family: 7 trades −10.4% · param_sweep best
**+3.7%** · seasonality bucket theo tháng · basis F1M 31-37bps.

## Nghiệm thu

"Backtest SMA FPT 1 năm" → baseline+strategy+sweep bảng, kèm caveat.
