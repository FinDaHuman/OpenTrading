---
name: bat-on-quoc-gia
description: "Chấm độ ổn định chính trị của MỘT nước theo thang 4 mức, có bằng chứng. Dùng khi hỏi một nước có bất ổn, biểu tình, đảo chính không."
activation: auto
requires_tools: [mcp__opentrading__geo_intel]
triggers:
  keywords: [bất ổn, bất ổn quốc gia, biểu tình, đảo chính, ổn định chính trị]
version: 1.3.0
---

# Đánh giá độ ổn định của một quốc gia

Đánh giá 1 quốc gia theo thang ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG, mỗi mức kèm evidence có URL. Hỏi nhiều nước thì chạy lặp skill này mỗi nước 1 lượt thay vì gộp.

## Khi nào dùng

- Dùng khi: user nêu tên MỘT quốc gia + hỏi bất ổn/ổn định/biểu tình/đảo chính.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - So sánh/bản đồ nhiều nước, bầu cử/chính sách toàn cầu → `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Chiến sự/xung đột vũ trang + ảnh hưởng thị trường → `danh-gia-tinh-hinh-xung-dot`.

## Các bước

**Bước 1: Đo cường độ (bắt buộc).**

Chạy song song 2 calls cùng upstream GDELT: `geo_intel` (topic = tên nước tiếng Anh) + `event_stats` (query = tên nước tiếng Anh). `geo_intel` đã lọc tin chính trị (bỏ thể thao/nhiễu) và trả aggregate (count/by_day/top_sources); `event_stats` trả aggregate base-rate — dùng geo_intel cho articles, event_stats cho count so baseline. CẤM đi web_search/web_fetch trước khi có counts GDELT — web chỉ dùng ở Bước 2 khi Bước 1 mỏng. Query tiếng Anh 1 lần + tối đa 1 biến thể; query tiếng Việt rỗng là đặc trưng data, không phải lỗi. GDELT rate-limit thì retry tối đa 1 lần sau backoff (server đã cache 600s); vẫn lỗi thì ghi trung thực và verdict dựa trên dữ liệu cũ.

**Bước 2: Xác minh bằng tin (chỉ khi Bước 1 mỏng).**

Chạy `news_market` (sources=gdelt, lọc theo tên nước) tuần tự sau Bước 1. Đủ counts + titles ở Bước 1 thì dừng, không chạy Bước 2. Coverage mỏng là KẾT QUẢ ("low-coverage ≠ stable"), không suy diễn thành ỔN ĐỊNH.

**Bước 3: Chốt verdict.**

Chỉ thêm `yf_commodities` hoặc `assets_rotation` (1 call) khi user hỏi rõ "ảnh hưởng thị trường". Tối đa 6 calls/run vì mỗi call ngoài tốn quota còn làm verdict loãng — dừng ngay khi đủ evidence.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Verdict 4 mức (chỉ chọn 1):** ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG.
2. **Căn cứ (mỗi mục 1 dòng + URL):** tần suất event GDELT (run này là baseline) · mức độ (keywords protest/conflict/coup trong titles) · coverage nước láng giềng · transmission sang giá nếu có Step phụ (dầu/vàng, đơn vị USD/oz hoặc % move).
3. **Provenance:** mỗi mục bắt buộc 1 dòng evidence + URL nguồn.

## Ví dụ

**Ví dụ 1:**
Hỏi: Bất ổn Thái Lan
Trả lời:
```
Verdict: CẢNH BÁO
- Tần suất event GDELT tăng vs baseline ... + URL
- Mức độ: keywords protest xuất hiện ... + URL
- Coverage nước láng giềng: ...
Provenance: (1 dòng evidence + URL cho mỗi mục trên)
```

**Ví dụ 2:**
Hỏi: Bất ổn Lào
Trả lời: Verdict kèm ghi chú trung thực "low-coverage ≠ stable", không suy diễn thành ỔN ĐỊNH.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: line event counts, line oil/gold.
