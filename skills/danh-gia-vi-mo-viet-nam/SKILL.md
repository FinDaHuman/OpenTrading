---
name: danh-gia-vi-mo-viet-nam
description: "Đọc vĩ mô Việt Nam: GDP, CPI, XNK, tỷ giá, lãi suất SBV, câu chuyện dẫn dắt và lịch công bố. Dùng khi hỏi số liệu hoặc bối cảnh vĩ mô VN."
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân, câu chuyện thị trường]
  # A trade question about one sector or product group belongs to xuat-nhap-khau-vn.
  exclude: [ngành xuất nhập khẩu, ngành xuất khẩu, nhóm hàng]
version: 1.6.1
---

# Vĩ mô Việt Nam

Mở đầu bắt buộc bằng pre-flight 2 calls (source_status + vs_auth_status) vì macro VN phụ thuộc JWT và HAR-session dễ chết. GDP, CPI, XK gọi bằng `indicator`, server tự điền cặp id.

## Khi nào dùng

- Dùng khi: user hỏi số liệu VN (GDP/CPI/XK/NK), lãi suất SBV, tỷ giá USDVND bối cảnh vĩ mô, lịch công bố NSO, báo cáo vĩ mô CTCK, câu chuyện dẫn dắt thị trường VN.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Vĩ mô Mỹ/toàn cầu, Fed bối cảnh, risk regime → dùng `danh-gia-vi-mo-quoc-te`.
  - Xác suất Fed cắt/giữ thuần odds → dùng `du-doan-fed`.
  - Thao tác vàng-tỷ giá chi tiết → dùng `phan-tich-vang-ty-gia`.

## Các bước

**Bước 0: Pre-flight (song song, bắt buộc).**

Chạy `source_status` + `vs_auth_status` trước mọi wave.

**Bước 1: Data VN bắt buộc.**

Song song `vs_indicator_data` với `indicator` = "GDP", "CPI", "XK" và `vs_xnk_detail` (chỉ 1 direction xk hoặc nk theo câu hỏi). Chỉ tiêu khác: lấy `category_id` + `term_type_id` từ `vs_categories` (cặp phải khớp, sai là rows rỗng). Rows rỗng → retry tối đa 1 lần → vẫn rỗng thì ghi "không có số liệu kỳ này".

**Bước 2: Tin vĩ mô (song song).**

Chạy `news_market` (lọc vĩ mô/lãi suất/tỷ giá) + `macro_events_vn` + `economic_calendar`.

**Bước 3: Báo cáo CTCK (1 call duy nhất).**

Chạy `analyst_consensus` (report_type=macro, limit=30) feed chung; lấy section pointers + dated reports. Không bắn theo từng từ khóa.

**Bước 4: Data bổ sung + lịch (song song, mỗi thứ tối đa 1 call).**

Chạy `snapshot_history` (macro_curated) + `yf_yield_curve` + `sbv_rates` + `vn_retail_fx` + `macro_events_vn` (NSO) + kỳ họp Fed/Mỹ (cross-ref `du-doan-fed`). Thiếu HAR session → macro trả permission message: ghi trung thực "macro cần session", fallback sang `snapshot_history`, không diễn giải message permission thành dữ liệu. Curve/DXY flaky → retry 1 lần sau backoff rồi bỏ.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Tăng trưởng:** GDP, ≥8 điểm cuối, đơn vị % yoy + URL/provenance.
2. **Lạm phát:** CPI, ≥8 điểm cuối, đơn vị % yoy + URL.
3. **Thương mại:** XK/NK/XNK-detail, đơn vị triệu USD + URL.
4. **Tỷ giá:** USDVND (đơn vị VND), SBV rates (tái cấp vốn/tái chiết khấu, đơn vị %) + URL.
5. **Lãi suất:** lãi suất điều hành SBV + bối cảnh hút vốn ngoại (curve/DXY) + URL.
6. **Điểm tích cực / tiêu cực + triển vọng tương lai.**
7. **Câu chuyện dẫn dắt thị trường + lịch sự kiện** (mỗi câu chuyện: sự kiện nào, ngày nào, tác động gì).

## Ví dụ

**Ví dụ 1:**
Hỏi: Vĩ mô VN
Đạt khi: verdict đủ 6 mục + câu chuyện dẫn dắt có lịch sự kiện, ≤12 calls.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: line GDP/CPI + times, bar diverging XNK, bar rates.
