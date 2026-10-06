---
name: ky-thuat-chuyen-sau
description: Đọc kỹ thuật thuần 1 mã đa khung 1D/1W/1M (RSI/MACD/BB/Ichimoku/ADX, Elliott/Wyckoff, hỗ trợ-kháng cự, higher-high hay lower-low). Luôn dùng skill này khi user hỏi kỹ thuật, breakout, đọc băng, sóng Elliott hay HH/LL của một mã — ví dụ "VCB kỹ thuật sao", "FPT có breakout không" — ngay cả khi user không nói rõ muốn "phân tích kỹ thuật".
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
tool_budget: 8
triggers:
  keywords: [kỹ thuật, rsi, macd, bb, bollinger, ichimoku, elliott, wyckoff, hỗ trợ, kháng cự, breakout, pattern, orderbook, băng giá, chỉ báo, adx, ema, sma, higher high, lower low, đa khung]
version: 1.2.1
---

# Reading Single-Stock Technicals

Mặc định 2 khung (1D+1W); khung 1M chỉ khi user hỏi dài hạn. Một call `signals_technical` đã đủ 80% verdict — đây là skill "1 tool trụ cột" mẫu mực, đừng gọi thêm tool cho đủ số.

## When to Use

- Dùng khi: user hỏi kỹ thuật 1 mã (`VCB kỹ thuật đa khung sao`, `FPT có breakout không`, `đọc băng HPG`, `higher-high hay lower-low`, `sóng Elliott`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi BCTC/cơ bản/M-Score → `co-ban-chuyen-sau`.
  - Hỏi định giá/fair value/PER/upside → `dinh-gia-chuyen-sau`.
  - Phân tích toàn diện 1 mã → `phan-tich-chuyen-sau-1-ma` (skill đó sẽ dispatch skill này).
  - So sánh nhiều mã → `so-sanh-cung-nganh`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: nến đa khung (mỗi khung 1 call)
- [ ] Step 2: đọc cấu trúc sóng từ output Step 1 (không gọi tool mới)
- [ ] Step 3: xác nhận theo câu hỏi (tối đa 3 calls)
- [ ] Step 4: verdict từng khung + tổng hợp
```

**Step 1: Nến đa khung.**

Chạy `signals_technical` (symbol, interval=1D) + (interval=1W) [+ (interval=1M) nếu hỏi dài hạn]. Mỗi khung 1 call: RSI/MACD/BB/Ichimoku/S-R/patterns. Interval chỉ nhận 1D/1W/1M (1W cần ≥30 bars, 1M ≥24 bars); interval lạ → `unavailable`, không retry.

**Step 2: Đọc cấu trúc sóng (không gọi tool mới).**

Từ output Step 1 đọc swings + swing_trend + fib + elliott + wyckoff; tự dán nhãn HH/HL/LH/LL + Fibonacci 7 mức + Elliott (impulse/corrective/developing + invalidation) + Wyckoff phase.

**Step 3: Xác nhận theo câu hỏi (tối đa 3 calls).**

Chỉ gọi khi user hỏi tới: `pattern_match` (analogy lịch sử) · `dnse_latest_trade` / `dnse_orderbook` / `vn_trades` (intraday) · `vn_index_ohlcv` (trend index). Không gọi `financial_detail` / `valuation_run` / `stock_forensic` ở đây.

**Step 4: Validate trước khi chốt.**

Mã mới <60 nến → indicators null → báo "thiếu lịch sử", không bịa RSI/MACD. DNSE hết giờ → orderbook rỗng là đúng data, ghi rõ phiên đóng. `pattern_match` corr <0.4 = không có analogy đáng tin → ghi đúng. Giá theo kVND (`signals_technical.last 57.3` = 57,300đ) → bắt buộc qui đổi + ghi đơn vị. Khung nào thiếu → verdict partial khung còn lại + ghi khung thiếu. Elliott/Wyckoff là heuristic → bắt buộc ghi confidence + invalidation.

## Template

ALWAYS use this exact verdict structure, cho MỖI khung (1D/1W[/1M]), mỗi mục ghi số + trend + provenance:

1. Trend: SMA stack + ADX. 2. Momentum: RSI/MACD/stoch/CCI cụ thể từng chỉ báo. 3. S-R của khung đó. 4. Cấu trúc: HH/HL/LH/LL + Fibo + Elliott pattern/invalidation + Wyckoff phase + confidence. 5. Kết luận khung: higher-high hay lower-low. 6. Tổng hợp: đồng thuận đa khung hay phân kỳ + trigger giá → timing MUA/CHỜ/BÁN. 7. Kết luận 1 câu chốt toàn mã.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: FPT kỹ thuật 1D+1W
Output: VCB — RSI 39.2, ADX 12.1 (trend yếu), MACD −0.31/−0.13, EMA10 58.09, pos_52w 0.21 · HPG pattern best_corr 0.409 (yếu — ghi đúng) · VCB 1W bearish/lower-low/fib-down nhất quán → verdict 2 khung + HH/LL + Ichimoku signal, ≤8 calls.
