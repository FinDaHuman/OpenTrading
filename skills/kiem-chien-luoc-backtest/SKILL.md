---
name: kiem-chien-luoc-backtest
description: Kiểm chứng chiến lược/backtest — code + pipeline 4 loại điều kiện (kỹ thuật, thời gian, sau sự kiện, giá hàng hóa), best KÈM worst param.
when_to_use: "SMA20/50 FPT có ăn không, mua khi RSI<30 có thắng không, tháng nào hay tăng, cổ phiếu sau Tết/chia cổ tức, theo giá dầu/vàng. Không dùng khi: sizing vị thế cụ thể (xem leg Đệm trong danh-gia-truoc-bctc)."
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
tool_budget: 12
triggers:
  keywords: [backtest, kiểm chứng, chiến lược, sma cross, rsi dưới, quá bán, momentum chiến lược, param sweep, mùa vụ tháng, sau tết, sau chia cổ tức, theo giá dầu, theo giá vàng]
version: 1.1.0
---

# Kiểm chứng chiến lược (backtest)

Pipeline chuẩn mỗi run: baseline → chiến lược → sweep → seasonality/event → kết luận.

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1. Dữ liệu | `vn_quote_history`(stock) hoặc `dnse_ohlc_history`(futures/index) · `vn_index_ohlcv`(benchmark) | 1 symbol/lần |
| 2. Điều kiện KỸ THUẬT | `backtest_strategies`(strategy=sma_cross/momentum/**rsi_meanrev** + rsi_low/rsi_high) | rsi_meanrev: mua RSI<30, thoát RSI>70 |
| 3. Điều kiện THỜI GIAN | `backtest_strategies` + `months`/`quarters` · `seasonality` (mô tả tháng/quý) | entries chỉ kỳ chọn, exits luôn mở |
| 4. Điều kiện SAU SỰ KIỆN | `event_study`(symbol, dates, window ±N) — CAR quanh Tết/cổ tức/ĐHĐCĐ (ngày từ `event_calendar_vn`) | nearest-day 3 phiên, hit-rate/best-worst |
| 5. Điều kiện GIÁ HÀNG HÓA | `backtest_strategies` + `condition_symbol` (BZ=F/GC=F... theo map ngành S13) + `condition_rule` above_sma/rising | vnstock→yfinance fallback trong tool |
| 6. Tổng hợp | `param_sweep`(≤30 combos, passthrough months/quarters) · `correlation_matrix` · `portfolio_optimize`(nhiều mã) | best KÈM worst (chống overfit) |

## Verdict

Baseline buy-hold → từng điều kiện (số trades/net/win) → best param + worst param →
seasonality/event bias → kết luận "đáng tin / đáng nghi + lý do". Ghi rõ engine: numpy-only,
cost mặc định, T+2 VN chưa model. `event_window` engine sâu và Elliott/Wyckoff full vẫn Phase 2.

## Chống tràn lan

- 1 symbol mỗi lần sweep; `param_sweep` cap 30 combos có sẵn — không tự nới; không sweep >3 symbol/run.
- `condition_symbol` chết → cả call unavailable, nói rõ (không thay symbol khác tự ý).

## Bằng chứng live (02-10-2026)

VCB buy-hold −4.9% gross · sma_cross 7 trades −10.4% · sweep best **+3.7%** · seasonality
tháng 1 mean +4.67% · rsi_meanrev VCB 1 trade · months=[1] trên nến tháng 3 → 0 trades +
warning · event_study VCB 2026-09-21: CAR +0.25%.

## Nghiệm thu

"Backtest mua RSI<30 FPT + backtest sau Tết" → bảng từng điều kiện + kết luận, kèm caveat.
