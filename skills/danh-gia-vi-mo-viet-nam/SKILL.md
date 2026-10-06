---
name: danh-gia-vi-mo-viet-nam
description: Đọc vĩ mô Việt Nam (GDP, CPI, XNK, tỷ giá USDVND, lãi suất SBV, câu chuyện dẫn dắt thị trường + lịch sự kiện). Luôn dùng skill này khi user hỏi số liệu, bối cảnh hoặc lịch công bố vĩ mô VN — ví dụ "GDP quý này bao nhiêu", "lãi suất SBV bao nhiêu" — ngay cả khi user không nói rõ muốn "đánh giá vĩ mô".
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
tool_budget: 12
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân, câu chuyện thị trường, dẫn dắt]
version: 1.2.1
---

# Reading Vietnam Macro

Mở đầu bắt buộc bằng pre-flight 2 calls (source_status + vs_auth_status) vì macro VN phụ thuộc JWT và HAR-session dễ chết. Cặp category/termType phải đúng tuyệt đối (sai là rows rỗng): GDP 73/tt3, CPI 15/tt7/sub2, XK 38/tt2.

## When to Use

- Dùng khi: user hỏi số liệu VN (GDP/CPI/XK/NK), lãi suất SBV, tỷ giá USDVND bối cảnh vĩ mô, lịch công bố NSO, báo cáo vĩ mô CTCK, câu chuyện dẫn dắt thị trường VN.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Vĩ mô Mỹ/toàn cầu, Fed bối cảnh, risk regime → dùng `danh-gia-vi-mo-quoc-te`.
  - Xác suất Fed cắt/giữ thuần odds → dùng `du-doan-fed`.
  - Thao tác vàng-tỷ giá chi tiết → dùng `phan-tich-vang-ty-gia`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 0: pre-flight nguồn (song song)
- [ ] Step 1: data VN bắt buộc (categories trước, indicators song song)
- [ ] Step 2: tin vĩ mô (song song)
- [ ] Step 3: báo cáo CTCK (1 call feed chung)
- [ ] Step 4: data bổ sung + lịch sự kiện
- [ ] Step 5: verdict 6 mục + câu chuyện
```

**Step 0: Pre-flight (song song, bắt buộc).**

Chạy `source_status` + `vs_auth_status` trước mọi wave.

**Step 1: Data VN bắt buộc.**

Chạy `vs_categories` trước (tra id nếu chưa chắc), rồi song song `vs_indicator_data` GDP + CPI + XK và `vs_xnk_detail` (chỉ 1 direction xk hoặc nk theo câu hỏi). Rows rỗng → kiểm tra lại cặp id, retry tối đa 1 lần → vẫn rỗng thì ghi "không có số liệu kỳ này".

**Step 2: Tin vĩ mô (song song).**

Chạy `news_market` (lọc vĩ mô/lãi suất/tỷ giá) + `macro_events_vn` + `economic_calendar`.

**Step 3: Báo cáo CTCK (1 call duy nhất).**

Chạy `analyst_consensus` (report_type=macro, limit=30) feed chung; lấy section pointers + dated reports. Không bắn theo từng từ khóa.

**Step 4: Data bổ sung + lịch (song song, mỗi thứ tối đa 1 call).**

Chạy `snapshot_history` (macro_curated) + `yf_yield_curve` + `sbv_rates` + `vn_retail_fx` + `macro_events_vn` (NSO) + kỳ họp Fed/Mỹ (cross-ref `du-doan-fed`). Thiếu HAR session → macro trả permission message: ghi trung thực "macro cần session", fallback sang `snapshot_history`, không diễn giải message permission thành dữ liệu. Curve/DXY flaky → retry 1 lần sau backoff rồi bỏ.

## Template

ALWAYS use this exact verdict structure:

1. **Tăng trưởng:** GDP, ≥8 điểm cuối, đơn vị % yoy + URL/provenance.
2. **Lạm phát:** CPI, ≥8 điểm cuối, đơn vị % yoy + URL.
3. **Thương mại:** XK/NK/XNK-detail, đơn vị triệu USD + URL.
4. **Tỷ giá:** USDVND (đơn vị VND), SBV rates (tái cấp vốn/tái chiết khấu, đơn vị %) + URL.
5. **Lãi suất:** lãi suất điều hành SBV + bối cảnh hút vốn ngoại (curve/DXY) + URL.
6. **Điểm tích cực / tiêu cực + triển vọng tương lai.**
7. **Câu chuyện dẫn dắt thị trường + lịch sự kiện** (mỗi câu chuyện: sự kiện nào, ngày nào, tác động gì).

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Vĩ mô VN
Output: GDP 504 rows tới Q2/2026 · CPI 1,839 · XK 2,941 · XNK-country 3,675 · SBV tái cấp vốn 4.5% / tái chiết khấu 3% · USDVND 25,970 · NSO lịch CPI tháng 8 → verdict đủ 6 mục + câu chuyện dẫn dắt có lịch sự kiện, ≤12 calls.
