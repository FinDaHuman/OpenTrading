---
name: kiem-chien-luoc-backtest
description: "Kiểm chứng chiến lược bằng backtest (SMA cross, RSI, momentum, mùa vụ, theo dầu/vàng), báo cả kết quả tốt nhất và tệ nhất. Dùng khi hỏi chiến lược có hiệu quả không."
activation: auto
requires_tools: [mcp__opentrading__quant_backtest]
triggers:
  keywords: [backtest, kiểm chứng chiến lược, chiến lược giao dịch, sma cross, rsi dưới, quá bán, momentum chiến lược, param sweep, mùa vụ tháng, sau tết, sau chia cổ tức, theo giá dầu, theo giá vàng]
version: 1.3.0
---

# Backtest chiến lược giao dịch

Pipeline chuẩn mỗi run: baseline → chiến lược → sweep → seasonality/event → kết luận. Best bắt buộc kèm worst (chống overfit); thiếu worst hoặc thiếu caveat engine thì chưa đạt. Engine numpy-only, cost mặc định, T+2 VN chưa model — mọi kết luận đều kèm caveat này.

## Khi nào dùng

- Dùng khi: kiểm chứng điều kiện kỹ thuật (SMA/momentum/RSI), thời gian (tháng/quý), sau sự kiện (Tết/cổ tức/ĐHĐCĐ), theo giá hàng hóa (dầu/vàng).
- Khi KHÔNG dùng (dùng skill khác thay thế): sizing vị thế cụ thể → leg Đệm trong `danh-gia-truoc-bctc`; định giá → `dinh-gia-chuyen-sau`; tin/sentiment → `tim-kiem-tin-tuc` / `phan-tich-sentiment`.

## Các bước

**Bước 1: Dữ liệu (tuần tự đầu tiên).**

Chạy `vn_quote_history` (stock) hoặc `dnse_ohlc_history` (futures/index) + `vn_index_ohlcv` (benchmark). Chỉ 1 symbol mỗi lần sweep. Mã cổ phiếu VN thì dùng nến equity — CẤM dùng `vn_crypto_ohlcv`.

**Bước 2: Điều kiện kỹ thuật.**

Chạy `backtest_strategies` (strategy=sma_cross/momentum/**rsi_meanrev** + rsi_low/rsi_high). rsi_meanrev: mua RSI<30, thoát RSI>70. `quant_backtest` đã deprecated cho chiến lược (chỉ còn baseline buy-hold) — mọi so sánh timing rule đi qua `backtest_strategies`, không gọi `quant_backtest` ở step này.

**Bước 3: Điều kiện thời gian.**

Chạy `backtest_strategies` + `months`/`quarters` + `seasonality` (mô tả tháng/quý). Entries chỉ kỳ chọn, exits luôn mở. Months=[1] trên nến tháng 3 → 0 trades + warning là hợp lệ, không retry đổi timeframe.

**Bước 4: Điều kiện sau sự kiện.**

Chạy `event_study` (symbol, dates, window ±N) — CAR quanh Tết/cổ tức/ĐHĐCĐ, ngày từ `event_calendar_vn`, nearest-day 3 phiên, kèm hit-rate/best-worst.

**Bước 5: Điều kiện giá hàng hóa.**

Chạy `backtest_strategies` + `condition_symbol` (BZ=F/GC=F...) + `condition_rule` above_sma/rising. `condition_symbol` chết thì cả call unavailable — nói rõ, không thay symbol khác. Fallback vnstock→yfinance nằm trong tool, không tự đổi nguồn tay.

**Bước 6: Tổng hợp.**

Chạy `param_sweep` (tối đa 30 combos có sẵn, không tự nới; passthrough months/quarters) + `correlation_matrix` + `portfolio_optimize` (nhiều mã). Không sweep quá 3 symbol/run.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau: baseline buy-hold → từng điều kiện (số trades/net/win) → best param + worst param → seasonality/event bias → kết luận "đáng tin / đáng nghi + lý do" + caveat engine (numpy-only, cost mặc định, T+2 chưa model) + provenance (nguồn nến, benchmark, ngày sự kiện).

## Ví dụ

**Ví dụ 1:**
Hỏi: Backtest mua RSI<30 FPT + backtest sau Tết
Trả lời: VCB buy-hold <số> gross · sma_cross 7 trades <số> · sweep best **<số>** · seasonality tháng 1 mean <số> · rsi_meanrev VCB 1 trade · months=[1] trên nến tháng 3 → 0 trades + warning · event_study VCB <số>-<số>: CAR <số> → bảng từng điều kiện (trades/net/win) + best/worst + kết luận, kèm caveat T+2/cost.

## Trực quan hóa

Dữ liệu skill này nhận: net return best/worst vs benchmark, CAR ±N quanh sự kiện, seasonality 12 tháng, ma trận tương quan. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (bar diverging best/worst, line CAR path, bar/heatmap seasonality, heatmap correlation), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
