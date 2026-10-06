---
name: so-sanh-cung-nganh
description: "Xếp hạng 2-6 mã cùng ngành và chọn leader (chất lượng × momentum) trong tối đa 8 calls nhà. Luôn dùng skill này khi user hỏi so sánh mã cùng ngành, mã nào mạnh nhất/đáng mua — ví dụ 'VCB vs BID vs CTG', 'steel mạnh nhất là ai' — ngay cả khi user không nói rõ muốn 'so sánh cùng ngành'."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
tool_budget: 8
triggers:
  keywords: [so sánh, vs, so với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.2.0
---

# Ranking Same-Sector Stocks

Skill điều phối thứ hai (cùng họ `phan-tich-chuyen-sau-1-ma`): xác định mã cùng ngành, gọi 1 sub-skill cho từng mã, gộp xếp hạng. Mỗi mã chỉ 1 sub-skill theo câu hỏi (momentum → kỹ thuật; chất lượng → cơ bản; đắt rẻ → định giá) — không chạy full 3 chiều/mã, không chạy vòng sub-skill thứ hai.

## When to Use

- Dùng khi: user hỏi so sánh/xếp hạng 2–6 mã cùng ngành (`VCB vs BID vs CTG`, `steel mạnh nhất là ai`, `ngân hàng nào đáng mua nhất`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chỉ 1 mã → `phan-tich-chuyen-sau-1-ma`.
  - Hỏi lẻ 1 chiều 1 mã (RSI → `ky-thuat-chuyen-sau`; BCTC → `co-ban-chuyen-sau`; fair value → `dinh-gia-chuyen-sau`).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 0: xác định mã cùng ngành (tối đa 6 mã)
- [ ] Step 1: bảng nhanh (overview + momentum + giá 1 shot)
- [ ] Step 2: 1 sub-skill/mã, song song tối đa 4
- [ ] Step 3: nền ngành + verdict xếp hạng
```

**Step 0: Xác định mã cùng ngành (gọi trực tiếp).**

Chạy `vn_reference` (industry) hoặc `vs_industry_tree` (tra GICS) → chọn tối đa 6 mã; chỉ cho tên ngành thì dùng `stock_screener` (filter ngành, pool hẹp). Trên 6 mã thì yêu cầu thu hẹp, không tự mở rộng. `vn_reference` industry không match → thử `vs_industry_tree` 1 lần, vẫn không ra thì hỏi lại ngành, không đoán mã.

**Step 1: Bảng nhanh (gọi trực tiếp).**

Chạy `compare_equities` (≤4 mã/lần; 5–6 mã thì chia 4+2 với `peer_compare`) + `vn_equity_quote_batch` (≤6 mã, 1 call): overview + momentum + bảng giá 1 shot.

**Step 2: Gọi sub-skill cho từng mã (dispatch, song song tối đa 4).**

Dispatch `ky-thuat-chuyen-sau` HOẶC `co-ban-chuyen-sau` HOẶC `dinh-gia-chuyen-sau` cho mỗi mã theo câu hỏi. Không gọi trực tiếp `signals_technical` / `financial_detail` / `valuation_run` ở đây.

**Step 3: Nền ngành + validate.**

Chạy `vs_gics_index` (group) làm nền index ngành (1 call). Enrich throttle giờ cao điểm → ratios rỗng → verdict kỹ thuật-only + ghi chú thiếu, không bịa PE/ROE. Thiếu dữ liệu 1 tiêu chí → xếp hạng partial + ghi "n/6 mã có đủ", không loại mã âm thầm.

## Template

ALWAYS use this exact verdict structure, mỗi mục ghi số + provenance:

1. Bảng xếp hạng {mã · PE · ROE · momentum · RS · giá} (`provenance: compare_equities` / `peer_compare` / `vn_equity_quote_batch` + sub-skill Step 2).
2. 1 dòng luận chọn: leader = chất lượng × momentum; định giá tốt = PE thấp trong nhóm ROE cao.
3. Cảnh báo tương quan nhóm khi chia tiền cả nhóm (cross-ref `correlation_matrix`, chỉ tham chiếu).
4. Kết luận 1 câu: chọn mã nào + vì sao.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: So sánh bank
Output: compare_equities VCB-vs-HPG 2.8s · peer_compare cap 6 · vs_gics_index 3 nhóm live · quote_batch 1 request VN30 · HOSE universe 757 mã → peer list ≤6 + sub-skill calls có giới hạn + bảng xếp hạng, ≤8 calls nhà.
