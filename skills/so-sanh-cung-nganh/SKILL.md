---
name: so-sanh-cung-nganh
description: "Xếp hạng 2–6 mã cùng ngành theo chất lượng và đà tăng, chọn mã dẫn đầu. Dùng khi hỏi so sánh các mã cùng ngành, mã nào mạnh nhất."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
triggers:
  keywords: [so sánh, vs, so với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.3.0
---

# So sánh mã cùng ngành

Skill điều phối thứ hai (cùng họ `phan-tich-chuyen-sau-1-ma`): xác định mã cùng ngành, gọi 1 sub-skill cho từng mã, gộp xếp hạng. Mỗi mã chỉ 1 sub-skill theo câu hỏi (momentum → kỹ thuật; chất lượng → cơ bản; đắt rẻ → định giá) — không chạy full 3 chiều/mã, không chạy vòng sub-skill thứ hai.

## Khi nào dùng

- Dùng khi: user hỏi so sánh/xếp hạng 2–6 mã cùng ngành (`VCB vs BID vs CTG`, `steel mạnh nhất là ai`, `ngân hàng nào đáng mua nhất`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chỉ 1 mã → `phan-tich-chuyen-sau-1-ma`.
  - Hỏi lẻ 1 chiều 1 mã (RSI → `ky-thuat-chuyen-sau`; BCTC → `co-ban-chuyen-sau`; fair value → `dinh-gia-chuyen-sau`).

## Các bước

**Bước 0: Xác định mã cùng ngành (gọi trực tiếp).**

Chạy `vn_reference` (industry) hoặc `vs_industry_tree` (tra GICS) → chọn tối đa 6 mã; chỉ cho tên ngành thì dùng `stock_screener` (filter ngành, pool hẹp). Trên 6 mã thì yêu cầu thu hẹp, không tự mở rộng. `vn_reference` industry không match → thử `vs_industry_tree` 1 lần, vẫn không ra thì hỏi lại ngành, không đoán mã.

**Bước 1: Bảng nhanh (gọi trực tiếp).**

Chạy `compare_equities` (≤4 mã/lần; 5–6 mã thì chia 4+2 với `peer_compare`) + `vn_equity_quote_batch` (≤6 mã, 1 call): overview + momentum + bảng giá 1 shot.

**Bước 2: Gọi sub-skill cho từng mã (dispatch, song song tối đa 4).**

Dispatch `ky-thuat-chuyen-sau` HOẶC `co-ban-chuyen-sau` HOẶC `dinh-gia-chuyen-sau` cho mỗi mã theo câu hỏi. Không gọi trực tiếp `signals_technical` / `financial_detail` / `valuation_run` ở đây.

**Bước 3: Nền ngành + validate.**

Chạy `vs_gics_index` (group) làm nền index ngành (1 call). Enrich throttle giờ cao điểm → ratios rỗng → verdict kỹ thuật-only + ghi chú thiếu, không bịa PE/ROE. Thiếu dữ liệu 1 tiêu chí → xếp hạng partial + ghi "n/6 mã có đủ", không loại mã âm thầm.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + provenance:

1. Bảng xếp hạng {mã · PE · ROE · momentum · RS · giá} (`provenance: compare_equities` / `peer_compare` / `vn_equity_quote_batch` + sub-skill Bước 2).
2. 1 dòng luận chọn: leader = chất lượng × momentum; định giá tốt = PE thấp trong nhóm ROE cao.
3. Cảnh báo tương quan nhóm khi chia tiền cả nhóm (cross-ref `correlation_matrix`, chỉ tham chiếu).
4. Kết luận 1 câu: chọn mã nào + vì sao.

## Ví dụ

**Ví dụ 1:**
Hỏi: So sánh bank
Trả lời: compare_equities VCB-vs-HPG <số>s · peer_compare cap 6 · vs_gics_index 3 nhóm live · quote_batch 1 request VN30 · HOSE universe <số> mã → peer list ≤6 + sub-skill calls có giới hạn + bảng xếp hạng, ≤8 calls nhà.
