---
name: tim-co-hoi-bao-cao-ctck
description: "Tổng hợp khuyến nghị của CTCK: rating, giá mục tiêu, upside đã đối chiếu giá hiện tại. Dùng khi hỏi CTCK khuyên mua gì hoặc target mới của một mã."
activation: auto
requires_tools: [mcp__opentrading__analyst_consensus]
triggers:
  keywords: [ctck, khuyên mua, giá mục tiêu, target, báo cáo phân tích, khuyến nghị, rating]
version: 1.5.0
---

# Cơ hội từ báo cáo CTCK

Khuyến nghị CTCK là INPUT, không phải chân lý — bắt buộc kiểm chứng upside bằng giá hiện tại và kèm disclaimer. Không bao giờ suy diễn khuyến nghị thành "nên mua", không bịa giá mục tiêu khi feed không có.

## Khi nào dùng

- Dùng khi: hỏi rating/target/báo cáo CTCK theo feed chung hoặc theo mã cụ thể, cần bảng upside %.
- Khi KHÔNG dùng (dùng skill khác thay thế): rumor/crowd → `phan-tich-sentiment` / `tim-kiem-tin-tuc`; tự định giá → `dinh-gia-chuyen-sau`; backtest → `kiem-chien-luoc-backtest`.

## Các bước

**Bước 1: Feed chung (1 call duy nhất).**

Chạy `analyst_consensus` (limit=30, days=7) — feed chung không symbol, parse rating + giá mục tiêu từ titles. `days` lọc N ngày gần nhất; dòng không đọc được ngày vẫn giữ, gắn `date_uncertain:true`. Báo cáo vĩ mô thì thêm `analyst_consensus` (report_type=macro): lọc báo cáo vĩ mô CTCK (entry section/report); không có dated reports thì dùng số liệu gốc. Feed rỗng thật (cuối tuần) → empty hợp lệ, nới `days` 1 lần duy nhất rồi kết luận.

**Bước 2: Mã cụ thể + tài liệu gốc (tuần tự sau Bước 1).**

Chạy `analyst_consensus` (symbol, limit=15) + `vs_documents` (symbol, chỉ lấy 1 mã đáng giá nhất).

Tiêu đề trong feed là đủ cho câu hỏi "CTCK khuyên gì". Chỉ `web_fetch` trang báo cáo khi câu hỏi cần nội dung ngoài tiêu đề (luận điểm, lý do giá mục tiêu), tối đa 3 báo cáo, ưu tiên MUA và mới nhất; truyền `prompt` để chỉ lấy khuyến nghị, giá mục tiêu, luận điểm chính. PDF không đọc được chữ thì đưa link và nói rõ chưa đọc nội dung. Hỏi mã cụ thể mà `analyst_consensus` (symbol) empty → đọc feed chung và lọc title chứa mã (title-scrape filter có thể sót), không retry đổi limit.

**Bước 3: Kiểm chứng upside (tuần tự, 1–2 mã nổi bật nhất).**

Chạy `stock_overview` (1–2 call) so giá hiện tại vs mục tiêu → upside %. Chỉ kiểm chứng top, không kiểm chứng tất cả.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

- Bảng {mã · CTCK · rating · giá mục tiêu · ngày · upside % so giá hiện tại}, lọc trong `days` (default 7).
- Top 3 cơ hội (upside lớn + rating MUA + còn hiệu lực).
- Cột **"đã kiểm chứng"** bắt buộc = Bước 3 chạy cho 1–2 mã nổi bật nhất (có `stock_overview`); mã chưa kiểm chứng ghi rõ "chưa kiểm chứng giá hiện tại".
- Disclaimer bắt buộc: khuyến nghị CTCK là INPUT, không phải chân lý — không suy diễn thành "nên mua".
- Provenance: nguồn ngày từ URL/title; nếu `source/date null` (đặc trưng parse titles) → suy ngày từ URL/title + ghi rõ nguồn ngày "không chắc chắn". Đủ bảng ≥5 dòng + kiểm chứng 2 mã top thì dừng, không đào thêm mã ngoài top.

## Ví dụ

**Ví dụ 1:**
Hỏi: CTCK khuyên mua gì tuần này
Đạt khi: bảng ≥5 dòng có upside %, kiểm chứng 2 mã top, ≤8 calls. Thiếu cột "đã kiểm chứng" hoặc thiếu disclaimer thì chưa đạt; bịa target khi feed rỗng thì chưa đạt.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: bar diverging upside.
