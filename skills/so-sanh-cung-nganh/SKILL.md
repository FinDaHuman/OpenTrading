---
name: so-sanh-cung-nganh
description: So sánh 2-6 mã CÙNG NGÀNH bằng cách gọi các skill chuyên cho từng mã rồi xếp hạng — bảng + 1 dòng luận chọn.
when_to_use: "VCB vs BID vs CTG, steel mạnh nhất là ai, ngân hàng nào đáng mua nhất. Không dùng khi: 1 mã (phan-tich-chuyen-sau-1-ma)."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
tool_budget: 8
triggers:
  keywords: [so sánh, vs, so với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.1.0
---

# So sánh cùng ngành (điều phối)

Skill điều phối thứ hai (cùng họ phan-tich-chuyen-sau-1-ma): xác định mã cùng ngành,
gọi skill chuyên cho từng mã, gộp xếp hạng.

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 0. Xác định mã cùng ngành | `vn_reference`(industry) hoặc `vs_industry_tree` (tra GICS) → chọn ≤6 mã · `stock_screener` (filter ngành, pool hẹp) khi chỉ cho tên ngành | cap tuyệt đối 6 mã — trên 6 thì yêu cầu thu hẹp |
| 1. Bảng nhanh | `compare_equities`(≤4) + `peer_compare` (chia 4+2 khi 5–6 mã) · `vn_equity_quote_batch`(≤6 mã, 1 call) | overview + momentum + bảng giá 1 shot |
| 2. Gọi skills trên | Mỗi mã: ky-thuat-chuyen-sau HOẶC co-ban-chuyen-sau HOẶC dinh-gia-chuyen-sau — theo câu hỏi, song song ≤4 | không chạy cả 3 sub-skills cho cả 6 mã |
| 3. Bối cảnh ngành | `vs_gics_index`(group) — index ngành làm nền | 1 call |

## Verdict

Bảng xếp hạng {mã · PE · ROE · momentum · RS · giá} + **1 dòng luận chọn** (leader = chất
lượng×momentum; định giá tốt = PE thấp trong nhóm ROE cao) + cảnh báo tương quan nhóm
(cross-ref `correlation_matrix` khi chia tiền cả nhóm).

## Chống tràn lan

- Thiếu dữ liệu 1 tiêu chí → xếp hạng partial + ghi "n/6 mã có đủ", không loại âm thầm.
- Sub-skill calls tính vào budget sub-skill, không cộng dồn vô hạn.

## Lỗi thường gặp

Enrich throttle giờ cao điểm → ratios rỗng → verdict kỹ thuật-only, ghi chú.
`vn_reference` industry không match → thử `vs_industry_tree` 1 lần.

## Bằng chứng live (02-10-2026)

compare_equities VCB-vs-HPG 2.8s · peer_compare cap 6 · vs_gics_index 3 nhóm live ·
quote_batch 1 request VN30 · HOSE universe 757 mã.

## Nghiệm thu

"So sánh bank" → peer list ≤6 + sub-skill calls có giới hạn + bảng xếp hạng, ≤8 calls nhà.
