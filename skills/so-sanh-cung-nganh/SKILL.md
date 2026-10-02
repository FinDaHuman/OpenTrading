---
name: so-sanh-cung-nganh
description: So sánh 2-6 mã CÙNG NGÀNH / chọn leader — bảng xếp hạng + 1 dòng luận chọn.
when_to_use: "VCB vs BID vs CTG, steel mạnh nhất là ai, ngân hàng nào đáng mua nhất. Không dùng khi: 1 mã (phan-tich-chuyen-sau-1-ma / co-ban-chuyen-sau / dinh-gia-chuyen-sau), ngành chảy tiền thế nào (luan-chuyen-nganh-viet-nam), user đưa FILTER chứ không đưa mã (san-loc-co-phieu)."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
tool_budget: 8
triggers:
  keywords: [so sánh, vs, so với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.0.0
---

# So sánh cùng ngành

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 0 (nếu nhập ngành) | `vn_reference`(industry) → chọn ≤6 mã | hoặc `vs_industry_tree`(tra GICS id) 1 call |
| 1 | `compare_equities`(≤4) | overview + momentum; 5-6 mã → chia 4+2 qua `peer_compare` |
| 2 | `signals_technical` × ≤4 mã (song song 4) | RS/pos_52w từng ứng viên |
| 3 | `financial_ratios` × ≤3 (song song 3) | PE/ROE/biên |
| 4 (bối cảnh) | `vs_gics_index`(group) · `vn_equity_quote_batch`(≤6 mã, 1 call) | index ngành + bảng giá 1 shot |

## Verdict

Bảng xếp hạng {mã · PE · ROE · momentum · RS · giá} + **1 dòng luận chọn** (leader = chất
lượng×momentum; định giá tốt = PE thấp trong nhóm ROE cao) + cảnh báo (correlation_matrix
cross-ref khi user hỏi "chia tiền cả nhóm").

## Chống tràn lan

- Cap tuyệt đối 6 mã/run — trên 6 → yêu cầu thu hẹp; `signals_technical` tối đa 4.
- Thiếu dữ liệu 1 tiêu chí → xếp hạng partial + ghi "n/6 mã có đủ", không loại âm thầm.

## Lỗi thường gặp

Enrich throttle giờ cao điểm (0/20 từng live) → ratios rỗng → verdict kỹ thuật-only, ghi
chú. `vn_reference` industry không match → thử `vs_industry_tree` 1 lần.

## Bằng chứng live (02-10-2026)

compare_equities VCB-vs-HPG 2.8s · peer_compare cap 6 · vs_gics_index 3 nhóm live ·
quote_batch 1 request VN30 · HOSE universe 757 mã.

## Nghiệm thu

"So sánh bank" → bảng ≥4 mã xếp hạng + luận chọn 1 dòng, ≤8 calls.
