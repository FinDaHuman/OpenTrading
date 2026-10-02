---
name: san-loc-co-phieu
description: Sàng lọc danh sách mã theo tiêu chí định giá/chất lượng/kỹ thuật — bảng ≤10 mã kèm lý do.
when_to_use: "PE thấp ROE cao, RSI quá bán, breakout, mã ngành ngân hàng. Không dùng khi: 1 mã đã biết (phan-tich-chuyen-sau-1-ma), so sánh nhóm mã cụ thể (so-sanh-cung-nganh)."
activation: auto
requires_tools: [mcp__opentrading__stock_screener]
tool_budget: 12
triggers:
  keywords: [sàng lọc, screener, lọc cổ phiếu, tìm cổ phiếu, mã nào, rsi, oversold, quá bán, breakout, breach, danh sách mã]
version: 1.0.0
---

# Sàng lọc cổ phiếu

## Workflow

| Wave | Tools |
|---|---|
| 1 | `signals_screener_columns`(tra field nếu chưa chắc) · `vn_reference`(exchange/sector pool) |
| 2 | `stock_screener` — **LUÔN truyền filters hẹp + limit ≤20** |
| 3 | `signals_technical` × 5 candidates top (song song ≤5) |
| 4 | `peer_compare`(nhóm đạt) · `watchlist_add`(lưu, hỏi user) |

## Verdict

Bảng ≤10 mã × {tiêu chí đạt, RSI/trend, PE/ROE nếu có, 1 dòng lý do} + cảnh báo lọc (enrich ratio).

## Chống tràn lan (QUY TẮC SỐ 1)

- `filters=null` full 1522 mã = ~60s → TIMEOUT đã ghi nhận live. TRÁNH: không filter →
  truyền `vn_reference` pool (ngành/sàn) hoặc universe nhỏ.
- `technical:{rsi_lt:30}` chạy trên candidates đã lọc, không trên cả universe.
- `max_pe/min_roe` kéo enrich tới 30 mã — chỉ dùng khi user thật sự cần valuation;
  warning "<50% enriched" → CHỐT kết quả, không retry.
- keys `technical` chỉ 4: rsi_lt/rsi_gt/above_sma20/below_sma20 — sai key = unavailable cả call.

## Lỗi thường gặp

Stage 0/20 enriched (giờ cao điểm vnstock) → output vẫn có technical, ghi "định giá chưa
kiểm tra". `signals_scan` ~40s → chỉ khi hỏi "săn breakout", cap `max_symbols=100`.

## Bằng chứng live (02-10-2026)

Screener RSI<70 HOSE trả SDA/CLH · scan 5 mã (HPG VCB FPT SSI VIC) → 0 hits (đúng —
Donchian không breakout hôm đó) · enrich 0/20 từng xảy ra, degrade đúng.

## Nghiệm thu

"Tìm mã RSI<30 PE<20 ngành ngân hàng" → ≤10 mã + lý do, ≤12 calls, 0 timeout giờ cao điểm.
