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

Trình bày kết luận đúng cấu trúc sau: mua và nắm giữ làm chuẩn so sánh → từng điều kiện (số lệnh, lợi nhuận ròng, tỷ lệ lệnh thắng) → cấu hình tốt nhất + tệ nhất → ảnh hưởng mùa vụ/sự kiện → kết luận "đáng tin / đáng nghi + lý do" + giới hạn của phép thử (chưa mô hình hoá T+2, phí giao dịch giả định bao nhiêu) + nguồn (nguồn nến, mốc so sánh, ngày sự kiện).

Nhãn trong bảng viết tiếng Việt: "số lệnh" (không "trades"), "lợi nhuận ròng" (không "net return"), "tỷ lệ lệnh thắng" (không "win rate"), "mức sụt giảm sâu nhất" (không "max drawdown"), "chiến lược mua và nắm giữ" (không "buy & hold"). Phí "10 bps" viết thành "10 điểm cơ bản (0,1%)" — 1 bps là 0,01%, không phải 1 điểm phần trăm. "Whipsaw" và "overfit" nói thẳng bằng lời: "đảo chiều liên tục trong giao dịch", "học kỹ quá khứ".

## Ví dụ

**Ví dụ 1:**
Hỏi: Backtest mua RSI<30 FPT + backtest sau Tết
Đạt khi: bảng từng điều kiện (trades/net/win) + best/worst + kết luận, kèm caveat T+2/cost.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: bar diverging best/worst, line CAR path, bar/heatmap seasonality, heatmap correlation.
