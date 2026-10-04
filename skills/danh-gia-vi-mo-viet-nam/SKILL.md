---
name: danh-gia-vi-mo-viet-nam
description: Đánh giá vĩ mô VN — GDP, CPI, xuất nhập khẩu, tỷ giá, lãi suất điều hành, báo cáo vĩ mô CTCK, câu chuyện dẫn dắt + lịch sự kiện.
when_to_use: "Hỏi GDP/CPI/XNK VN, tỷ giá USDVND bối cảnh vĩ mô, lãi suất SBV, lịch công bố số liệu, câu chuyện dẫn dắt thị trường. Không dùng khi: vĩ mô Mỹ/toàn cầu (danh-gia-vi-mo-quoc-te), vàng-tỷ giá thao tác (phan-tich-vang-ty-gia)."
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
tool_budget: 12
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân, câu chuyện thị trường, dẫn dắt]
version: 1.1.0
---

# Đánh giá vĩ mô Việt Nam

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 0 | `source_status` · `vs_auth_status` | pre-flight |
| 1. Dữ liệu vĩ mô VN chi tiết từ Vietstock (BẮT BUỘC) | `vs_categories` (tra id nếu cần) → `vs_indicator_data` GDP(73,tt3) · CPI(15,tt7,sub2) · XK(38,tt2) · `vs_xnk_detail` (xk + nk) | cặp category/termType phải ĐÚNG (sai là rows rỗng) |
| 2. Tin tức vĩ mô kinh tế | `news_market` (lọc vĩ mô/lãi suất/tỷ giá) · `macro_events_vn` · `economic_calendar` | Fireant/GDELT + NSO |
| 3. Báo cáo vĩ mô của CTCK | `analyst_consensus`(report_type=macro, limit=30) | section pointers + dated reports (entry_kind); không có dated thì dùng số liệu gốc wave 1 |
| 4. Data bổ sung | `snapshot_history`(macro_curated — baseline so số mới/cũ) · `yf_yield_curve` + DXY (bối cảnh hút vốn ngoại) · `sbv_rates` · `vn_retail_fx` | mỗi thứ 1 call |
| 5. Lịch sự kiện câu chuyện | `macro_events_vn` (NSO) + kỳ họp Fed/Mỹ (cross-ref du-doan-fed) | lịch VN + lịch ngoại tác động VN |

## Verdict

Tăng trưởng · lạm phát · thương mại · tỷ giá · lãi suất · **điểm tích cực / tiêu cực ·
triển vọng tương lai · câu chuyện dẫn dắt thị trường + lịch sự kiện của câu chuyện đó**
(mỗi câu chuyện: sự kiện nào, ngày nào, tác động gì). GDP/CPI/XK: lấy ≥8 điểm cuối, ghi rõ đơn vị.

## Chống tràn lan

- Không quét cả 60 categories — 4–6 series đủ; `vs_xnk_detail` chọn 1 direction theo câu hỏi.
- `analyst_consensus` macro 1 call feed chung, không bắn theo từng từ khóa.

## Lỗi thường gặp

Thiếu HAR session → macro trả permission message → BẢO TRUNG THỰC "macro cần session",
fallback `snapshot_history`; không diễn giải message permission thành dữ liệu.

## Bằng chứng live (02-10-2026)

GDP 504 rows tới Q2/2026 · CPI 1,839 · XK 2,941 · XNK-country 3,675 · SBV tái cấp vốn
4.5% / tái chiết khấu 3% · USDVND 25,970 · NSO lịch CPI tháng 8.

## Nghiệm thu

"Vĩ mô VN" → đủ 6 mục + câu chuyện dẫn dắt có lịch sự kiện, ≤12 calls.
