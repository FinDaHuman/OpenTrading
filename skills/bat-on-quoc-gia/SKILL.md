---
name: bat-on-quoc-gia
description: Đánh giá độ ổn định hoặc bất ổn chính trị của MỘT quốc gia (biểu tình, đảo chính, bất ổn) theo thang 4 mức kèm evidence. Luôn dùng skill này khi user hỏi tình hình ổn định của một nước cụ thể — ví dụ "Thái Lan đang bất ổn gì", "Trung Quốc có ổn định không", "Bangladesh sau đảo chính ra sao" — ngay cả khi user không nói rõ muốn "đánh giá".
activation: auto
requires_tools: [mcp__opentrading__geo_intel]
tool_budget: 6
triggers:
  keywords: [bất ổn, bất ổn quốc gia, biểu tình, đảo chính, ổn định, thái lan, bangladesh]
version: 1.1.0
---

# Assessing Single-Country Stability

Đánh giá 1 quốc gia theo thang ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG, mỗi mức kèm evidence có URL. Hỏi nhiều nước thì chạy lặp skill này mỗi nước 1 lượt thay vì gộp.

## When to Use

- Dùng khi: user nêu tên MỘT quốc gia + hỏi bất ổn/ổn định/biểu tình/đảo chính.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - So sánh/bản đồ nhiều nước, bầu cử/chính sách toàn cầu → `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Chiến sự/xung đột vũ trang + ảnh hưởng thị trường → `danh-gia-tinh-hinh-xung-dot`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: đo cường độ (GDELT counts + mức độ)
- [ ] Step 2: xác minh bằng tin (chỉ khi Step 1 mỏng)
- [ ] Step 3: verdict 4 mức + provenance
```

**Step 1: Đo cường độ (bắt buộc).**

Chạy song song 2 calls cùng upstream GDELT: `geo_intel` (topic = tên nước tiếng Anh) + `event_stats` (query = tên nước tiếng Anh). Query tiếng Anh 1 lần + tối đa 1 biến thể; query tiếng Việt rỗng là đặc trưng data, không phải lỗi. GDELT rate-limit thì retry tối đa 1 lần sau backoff (server đã cache 600s); vẫn lỗi thì ghi trung thực và verdict dựa trên dữ liệu cũ.

**Step 2: Xác minh bằng tin (chỉ khi Step 1 mỏng).**

Chạy `news_market` (sources=gdelt, lọc theo tên nước) tuần tự sau Step 1. Đủ counts + titles ở Step 1 thì dừng, không chạy Step 2. Coverage mỏng là KẾT QUẢ ("low-coverage ≠ stable"), không suy diễn thành ỔN ĐỊNH.

**Step 3: Chốt verdict.**

Chỉ thêm `yf_commodities` hoặc `assets_rotation` (1 call) khi user hỏi rõ "ảnh hưởng thị trường". Tối đa 6 calls/run vì mỗi call ngoài tốn quota còn làm verdict loãng — dừng ngay khi đủ evidence.

## Template

ALWAYS use this exact verdict structure:

1. **Verdict 4 mức (chỉ chọn 1):** ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG.
2. **Căn cứ (mỗi mục 1 dòng + URL):** tần suất event GDELT (run này là baseline) · mức độ (keywords protest/conflict/coup trong titles) · coverage nước láng giềng · transmission sang giá nếu có Step phụ (dầu/vàng, đơn vị USD/oz hoặc % move).
3. **Provenance:** mỗi mục bắt buộc 1 dòng evidence + URL nguồn.

## Examples

**Example 1:**
Input: Bất ổn Thái Lan
Output:
```
Verdict: CẢNH BÁO
- Tần suất event GDELT tăng vs baseline ... + URL
- Mức độ: keywords protest xuất hiện ... + URL
- Coverage nước láng giềng: ...
Provenance: (1 dòng evidence + URL cho mỗi mục trên)
```

**Example 2 (coverage mỏng):**
Input: Bất ổn Lào
Output: Verdict kèm ghi chú trung thực "low-coverage ≠ stable", không suy diễn thành ỔN ĐỊNH.
