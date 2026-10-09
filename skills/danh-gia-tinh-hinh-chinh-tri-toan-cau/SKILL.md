---
name: danh-gia-tinh-hinh-chinh-tri-toan-cau
description: "Lập 4–6 rủi ro chính trị toàn cầu (bầu cử, chính sách, căng thẳng), mỗi mục có odds và tin xác nhận. Dùng khi hỏi rủi ro chính trị ở nhiều nước."
activation: auto
triggers:
  keywords: [địa chính trị, bầu cử, chính trị, chính sách mỹ, căng thẳng quốc tế, rủi ro chính trị]
version: 1.3.0
---

# Bản đồ rủi ro chính trị toàn cầu

Skill tổ chức cross-ref (không có home tool riêng — ghép odds + tin từ nhiều nguồn). Mỗi mục verdict bắt buộc có event URL + tin URL, thiếu một trong hai thì ghi rõ.

## Khi nào dùng

- Dùng khi: user hỏi bản đồ rủi ro chính trị toàn cầu, bầu cử, chính sách, căng thẳng quốc tế (nhiều sự kiện, cần ghép odds + tin).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Xung đột vũ trang cụ thể → dùng `danh-gia-tinh-hinh-xung-dot`.
  - Bất ổn 1 nước → dùng `bat-on-quoc-gia`.
  - Chỉ xin odds/bảng Polymarket thuần → dùng `du-doan-polymarket`.
  - Fed cắt/giữ thuần → dùng `du-doan-fed`.

## Các bước

**Bước 1: Odds + intel (song song, bắt buộc).**

Chạy `world_prediction_odds` (tag=fed/politics/elections theo câu hỏi) + `geo_intel` (topic). Odds đã sort vol24h nên chỉ lấy top 5 — kéo cả 20 events là tràn lan.

**Bước 2: Drill-down (song song, tuần tự sau Bước 1).**

Chạy `polymarket_event` (slug top 1-2) + `event_stats` (query). Chỉ drill event thật sự liên quan câu hỏi, tối đa 2 slugs/run. Không gọi chồng chéo `geo_intel` + `event_stats` + `news_market` cùng query quá 1 vòng.

**Bước 3: Xác minh tin (tuần tự sau Bước 2).**

Chạy `news_market` (sources=gdelt) + `web_fetch` 1-2 URL nguồn chính thức trong tin. Đủ 4 mục có prob + tin xác nhận thì dừng.

**Bước 4: Validate trước khi chốt.**

GDELT rate-limit → backoff 20s, retry tối đa 1 lần → vẫn lỗi thì ghi trung thực "thiếu tin GDELT, verdict chỉ dựa trên odds". Gamma chậm thì tool tự fallback direct, chờ 1 lần. Odds stale (end-date qua) → lọc `end > today`, loại event hết hạn. Hai đường chết hết thì ghi "không có odds", không bịa xác suất.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Sự kiện:** tên + bối cảnh 1 dòng.
2. **Xác suất:** prob_pct từng outcome (đơn vị %) + end-date.
3. **Độ tin odds:** volume 24h + liquidity (đơn vị USD; <50k thì cờ "odds kém tin").
4. **Tin GDELT xác nhận:** 1 dòng + URL.
5. **Market-impact nếu có:** kênh truyền dẫn + URL.
6. **Provenance:** mỗi mục bắt buộc event URL + tin URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Rủi ro chính trị toàn cầu
Trả lời: Fed October <số> "no change" <số> (volume 24h ~<số>M USD) · Brazil presidential event OK · mỗi mục đủ prob_pct + provenance event URL.

## Trực quan hóa

Dữ liệu skill này nhận: odds % per event, GDELT counts. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (bar odds per event, line event counts), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
