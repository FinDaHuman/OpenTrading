---
name: tin-tuc-nong-viet-nam
description: "Tóm tắt 5–7 tin chứng khoán/doanh nghiệp VN trong ngày, phân loại và đánh giá tác động. Dùng khi hỏi chung tin nóng hôm nay."
activation: auto
requires_tools: [mcp__opentrading__news_market]
triggers:
  keywords: [tin nóng, tin chứng khoán, tin hôm nay, tin vn, tin doanh nghiệp, headline]
version: 1.3.0
---

# Tin nóng Việt Nam

Digest nhanh tin VN trong ngày — headline + phân loại + sentiment, có provenance rõ ràng. Không suy diễn sentiment heuristic thành khuyến nghị mua/bán.

## Khi nào dùng

- Dùng khi: hỏi tin nóng VN hôm nay, VN30, thị trường/doanh nghiệp VN, cần 5–7 headline nhanh.
- Khi KHÔNG dùng (dùng skill khác thay thế): có mã/từ khóa cụ thể hoặc rumor → `tim-kiem-tin-tuc`; tin Mỹ/Trung/toàn cầu → `tin-tuc-nong-quoc-te`; đào sâu crowd/FOMO 1 mã → `phan-tich-sentiment`; rating/target CTCK → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 1: Tin chung + lịch công bố (song song).**

Chạy `news_market` (limit=15) + `corporate_calendar` (limit=20).

**Bước 2: Đào mã nổi bật (tuần tự sau Bước 1).**

Chạy `news_symbol` × 2–3 mã xuất hiện nhiều nhất trong tin — chọn theo tần suất xuất hiện, không theo cảm tính, tối đa 3 mã.

**Bước 3: Sentiment + đối chiếu (song song).**

Chạy `sentiment_score` (mã nóng nhất) + `company_events` (mã đó, chỉ để đối chiếu, không đào toàn bộ lịch sử). Thiếu Groq → dùng heuristic + warning, bắt buộc nhãn `heuristic` trong verdict.

**Bước 4: Validate trước khi chốt.**

Fireant chết → tự GDELT fallback trong tool, không retry Fireant vô hạn. Cả hai chết → đọc `snapshot_history` (kind=news_feed) cache 1 ngày, bắt buộc ghi rõ là cache + ngày cache. Feed rỗng cuối tuần/nghỉ lễ → empty hợp lệ, ghi rõ "phiên nghỉ, ít tin mới". Đủ 5 headline có provenance thì dừng; đủ verdict Bước 3 cho mã nóng nhất thì dừng. Không call lại `sentiment_score` với limit lớn hơn.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi headline gồm: **tiêu đề + mã liên quan + phân loại** (catalyst / đồn đoán / tin vĩ mô) + **sentiment** nếu đủ dữ kiện + **provenance** (Fireant/GDELT) + **tuổi tin**. Tin đồn bắt buộc nhãn `CHƯA XÁC NHẬN`.

## Ví dụ

**Ví dụ 1:**
Hỏi: Tin nóng hôm nay
Đạt khi: ≥5 headline có provenance, ≤9 calls. Thiếu provenance hoặc thiếu phân loại thì chưa đạt; sentiment không nhãn nguồn thì chưa đạt.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`.
