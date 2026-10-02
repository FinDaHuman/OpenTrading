---
name: ky-thuat-chuyen-sau
description: Phân tích THUẦN kỹ thuật 1 mã — chỉ báo, pattern, S-R, RS vs index, intraday/orderbook.
when_to_use: "VCB kỹ thuật sao, FPT có breakout không, đọc băng HPG, RSI và hỗ trợ-kháng cự. Không dùng khi: cơ bản (co-ban-chuyen-sau), định giá (dinh-gia-chuyen-sau), săn toàn thị trường (san-loc-co-phieu)."
activation: auto
requires_tools: [mcp__opentrading__signals_technical]
tool_budget: 8
triggers:
  keywords: [kỹ thuật, rsi, macd, hỗ trợ, kháng cự, breakout, pattern, orderbook, băng giá, chỉ báo, adx, ema, sma]
version: 1.0.0
---

# Kỹ thuật chuyên sâu 1 mã

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1 | `signals_technical`(symbol) | 1 call = RSI/MACD/Bands/ADX/patterns/S-R/RS/pos_52w/sma150 |
| 2 (chọn) | `pattern_match`(symbol) · `vn_quote_history`(symbol, days=250) | analogy + tự vẽ đường xu hướng |
| 3 (intraday) | `dnse_latest_trade` · `dnse_orderbook` · `vn_trades` | ≤3, cùng upstream DNSE |
| 4 (index context) | `vn_index_ohlcv`(VNINDEX) | khi cần so trend index |

## Verdict

Trạng thái trend (đỉnh/đáy/downtrend/đi ngang bằng SMA stack + ADX) · momentum (RSI/MACD/
stoch) · vùng S-R + giá hiện tại nằm đâu · pattern + xác suất lịch sử (pattern_match corr) ·
RS vs VNINDEX · kết luận timing (MUA/CHỜ/BÁN + trigger giá).

## Chống tràn lan

- Wave 2 CHỈ khi user hỏi "mẫu hình/quá khứ"; wave 3 CHỈ khi intraday.
- `interval` khác 1D → tool trả warning — về 1D, không retry đổi params.
- `signals_technical` 1 call đã đủ 80% verdict — skill "1 tool trụ cột" mẫu mực.

## Lỗi thường gặp

Mã mới <60 nến → indicators null, báo "thiếu lịch sử". DNSE hết giờ → orderbook rỗng là
đúng. `pattern_match` corr <0.4 = không có analogy đáng tin. Giá theo kVND
(`signals_technical.last 57.3` = 57,300đ) — qui đổi + ghi đơn vị.

## Bằng chứng live (02-10-2026)

VCB — RSI 39.2, ADX 12.1 (trend yếu), MACD −0.31/−0.13, EMA10 58.09, pos_52w 0.21, recommend
Sell (HPG) · HPG pattern best_corr 0.409 (yếu — ghi đúng) · orderbook VCB depth live · băng 10:18 giá 58.1.

## Nghiệm thu

"RSI FPT và vùng hỗ trợ" → 2 mục verdict ≤2 calls; "intraday SSI" → thêm leg orderbook, tổng ≤8.
