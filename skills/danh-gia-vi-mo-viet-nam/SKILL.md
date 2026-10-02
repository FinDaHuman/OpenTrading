---
name: danh-gia-vi-mo-viet-nam
description: Đánh giá vĩ mô VN — GDP, CPI, xuất nhập khẩu, tỷ giá, lãi suất điều hành, lịch công bố.
when_to_use: "Hỏi GDP/CPI/XNK VN, tỷ giá USDVND bối cảnh vĩ mô, lãi suất SBV, lịch công bố số liệu. Không dùng khi: vĩ mô Mỹ/toàn cầu (danh-gia-vi-mo-quoc-te), vàng-tỷ giá thao tác (phan-tich-vang-ty-gia)."
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
tool_budget: 12
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân]
version: 1.0.0
---

# Đánh giá vĩ mô Việt Nam

## Workflow

| Wave | Tools |
|---|---|
| 0 | `source_status` · `vs_auth_status` |
| 1 (catalog) | `vs_categories` — tra category_id nếu chưa chắc |
| 2 (series) | `vs_indicator_data`(GDP: 73,tt3) · (CPI: 15,tt7,sub2) · (XK: 38,tt2) · `vs_xnk_detail`(xk) |
| 3 | `sbv_rates` · `macro_events_vn` · `vn_msn_fx_gold` · `vn_retail_fx` · `economic_calendar` |
| 4 (lịch sử) | `snapshot_history`(macro_curated) khi live fail |

## Verdict — 6 mục

Tăng trưởng (q/dư + trend) · lạm phát (yoy) · thương mại (cán cân, đối tác lớn) ·
tỷ giá (USDVND + spread SBV) · lãi suất điều hành · kỳ công bố sắp tới (ngày).
GDP/CPI/XK: lấy ≥8 điểm cuối, ghi rõ đơn vị.

## Chống tràn lan

- CẶP category/termType phải ĐÚNG (sai là rows rỗng — GDP đúng tt3, không phải tt2).
- Không quét cả 60 categories — chỉ 4-6 cần thiết. `vs_xnk_detail` theo direction riêng — chọn 1 theo câu hỏi.

## Lỗi thường gặp

Thiếu HAR session → macro trả permission message → BẢO TRUNG THỰC "macro cần session",
fallback `snapshot_history`; không diễn giải message permission thành dữ liệu.

## Bằng chứng live (02-10-2026)

GDP 504 rows tới Q2/2026 · CPI 1,839 · XK 2,941 · XNK-country 3,675 · SBV tái cấp vốn
4.5% / tái chiết khấu 3% · USDVND 25,970 · NSO lịch CPI tháng 8.

## Nghiệm thu

"Đánh giá vĩ mô VN" → đủ 6 mục, GDP+CPI có số quý gần nhất; thiếu session → nêu đúng tình trạng + dùng snapshot cache.
