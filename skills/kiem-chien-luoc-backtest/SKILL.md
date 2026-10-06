---
name: kiem-chien-luoc-backtest
description: Kiểm chứng chiến lược giao dịch bằng backtest code (SMA cross, RSI quá bán, momentum, param sweep kèm best VÀ worst, mùa vụ tháng, sau Tết/cổ tức, theo giá dầu/vàng). Luôn dùng skill này khi user hỏi chiến lược có ăn không, tháng/quý nào hay tăng — ví dụ "SMA20/50 FPT có ăn không", "mua RSI<30 có thắng không" — ngay cả khi user không nói rõ muốn "backtest".
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
tool_budget: 12
triggers:
  keywords: [backtest, kiểm chứng, chiến lược, sma cross, rsi dưới, quá bán, momentum chiến lược, param sweep, mùa vụ tháng, sau tết, sau chia cổ tức, theo giá dầu, theo giá vàng]
version: 1.2.1
---

# Backtesting Trading Strategies Honestly

Pipeline chuẩn mỗi run: baseline → chiến lược → sweep → seasonality/event → kết luận. Best bắt buộc kèm worst (chống overfit); thiếu worst hoặc thiếu caveat engine thì chưa đạt. Engine numpy-only, cost mặc định, T+2 VN chưa model — mọi kết luận đều kèm caveat này.

## When to Use

- Dùng khi: kiểm chứng điều kiện kỹ thuật (SMA/momentum/RSI), thời gian (tháng/quý), sau sự kiện (Tết/cổ tức/ĐHĐCĐ), theo giá hàng hóa (dầu/vàng).
- Khi KHÔNG dùng (dùng skill khác thay thế): sizing vị thế cụ thể → leg Đệm trong `danh-gia-truoc-bctc`; định giá → `dinh-gia-chuyen-sau`; tin/sentiment → `tim-kiem-tin-tuc` / `phan-tich-sentiment`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: dữ liệu + benchmark (1 symbol/lần)
- [ ] Step 2: điều kiện kỹ thuật
- [ ] Step 3: điều kiện thời gian
- [ ] Step 4: điều kiện sau sự kiện
- [ ] Step 5: điều kiện giá hàng hóa
- [ ] Step 6: sweep + tổng hợp best/worst
```

**Step 1: Dữ liệu (tuần tự đầu tiên).**

Chạy `vn_quote_history` (stock) hoặc `dnse_ohlc_history` (futures/index) + `vn_index_ohlcv` (benchmark). Chỉ 1 symbol mỗi lần sweep.

**Step 2: Điều kiện kỹ thuật.**

Chạy `backtest_strategies` (strategy=sma_cross/momentum/**rsi_meanrev** + rsi_low/rsi_high). rsi_meanrev: mua RSI<30, thoát RSI>70. `quant_backtest` đã deprecated cho chiến lược (chỉ còn baseline buy-hold) — mọi so sánh timing rule đi qua `backtest_strategies`, không gọi `quant_backtest` ở step này.

**Step 3: Điều kiện thời gian.**

Chạy `backtest_strategies` + `months`/`quarters` + `seasonality` (mô tả tháng/quý). Entries chỉ kỳ chọn, exits luôn mở. Months=[1] trên nến tháng 3 → 0 trades + warning là hợp lệ, không retry đổi timeframe.

**Step 4: Điều kiện sau sự kiện.**

Chạy `event_study` (symbol, dates, window ±N) — CAR quanh Tết/cổ tức/ĐHĐCĐ, ngày từ `event_calendar_vn`, nearest-day 3 phiên, kèm hit-rate/best-worst.

**Step 5: Điều kiện giá hàng hóa.**

Chạy `backtest_strategies` + `condition_symbol` (BZ=F/GC=F...) + `condition_rule` above_sma/rising. `condition_symbol` chết thì cả call unavailable — nói rõ, không thay symbol khác. Fallback vnstock→yfinance nằm trong tool, không tự đổi nguồn tay.

**Step 6: Tổng hợp.**

Chạy `param_sweep` (tối đa 30 combos có sẵn, không tự nới; passthrough months/quarters) + `correlation_matrix` + `portfolio_optimize` (nhiều mã). Không sweep quá 3 symbol/run.

## Template

ALWAYS use this exact verdict structure: baseline buy-hold → từng điều kiện (số trades/net/win) → best param + worst param → seasonality/event bias → kết luận "đáng tin / đáng nghi + lý do" + caveat engine (numpy-only, cost mặc định, T+2 chưa model) + provenance (nguồn nến, benchmark, ngày sự kiện).

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Backtest mua RSI<30 FPT + backtest sau Tết
Output: VCB buy-hold −4.9% gross · sma_cross 7 trades −10.4% · sweep best **+3.7%** · seasonality tháng 1 mean +4.67% · rsi_meanrev VCB 1 trade · months=[1] trên nến tháng 3 → 0 trades + warning · event_study VCB 2026-09-21: CAR +0.25% → bảng từng điều kiện (trades/net/win) + best/worst + kết luận, kèm caveat T+2/cost.
