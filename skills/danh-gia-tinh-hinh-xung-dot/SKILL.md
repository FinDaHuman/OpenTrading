---
name: danh-gia-tinh-hinh-xung-dot
description: "Đánh giá một cuộc xung đột: cường độ, dầu/vàng đã phản ánh chưa, kênh tác động, xác suất leo thang. Dùng khi hỏi chiến sự ảnh hưởng thị trường."
activation: auto
requires_tools: [mcp__opentrading__event_stats]
triggers:
  keywords: [xung đột, chiến tranh, biển đông, trung đông, leo thang, dầu hay vàng lên, chiến sự]
version: 1.3.0
---

# Tác động của xung đột vũ trang

Trả lời 5 mục cố định: cường độ → giá đã phản ánh → kênh truyền dẫn → xác suất leo thang → hàm ý vị thế. Không khuyến nghị mua/bán trực tiếp.

## Khi nào dùng

- Dùng khi: user nêu 1 xung đột/chiến sự cụ thể + hỏi cường độ, leo thang, giá đã phản ánh, kênh truyền dẫn, hàm ý vị thế.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chính trị/bầu cử rộng → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Bất ổn 1 nước (biểu tình/đảo chính, chưa thành chiến sự) → dùng `bat-on-quoc-gia`.
  - Chỉ xin odds thuần → dùng `du-doan-polymarket`.

## Các bước

**Bước 1: Đo cường độ (bắt buộc, song song).**

Chạy `geo_intel` (topic xung đột) + `event_stats` (query) cùng lúc. Từ khóa thử cả tiếng Việt lẫn Anh; GDELT rỗng với tiếng Việt là đặc trưng data (ghi "query VN rỗng, dùng EN query X", retry tối đa 1 lần EN), không phải lỗi.

**Bước 2: Kiểm tra giá đã phản ánh (song song, tuần tự sau Bước 1).**

Chạy `yf_commodities` (dầu + vàng) + `assets_rotation`. Thiếu phiên mới thì dùng phiên gần nhất có + ghi rõ date, không bịa giá hiện tại. Đủ counts Bước 1 + giá dầu/vàng Bước 2 là đủ verdict cơ bản.

**Bước 2b: Tần suất máy bay quân sự (tham chiếu oracle 8010, 1 call).**

Chạy `geo_intel` với `military=true` — trả máy bay quân sự live từ adsb.lol (count, by_country, by_type), khoảng cách tới vùng xung đột gần nhất (km) và signal-loss diff (máy bay biến mất gần zone = nghi tắt transponder, tín hiệu OSINT). Đọc: count cao + nhiều máy tankers/recon gần zone → tăng cường hoạt động; "Unknown" operator nhiều → mất dấu vết chính thức. Tool chết (adsb.lol 429/geo-block) thì ghi trung thực, không bịa số máy bay.

**Bước 3: Odds leo thang + xác minh (chỉ khi cần).**

Chạy `world_prediction_odds` (từ khóa cuộc chiến) + `web_search`/`web_fetch` (chỉ 1-2 nguồn). Không có market cho cuộc chiến thì ghi "không có odds", không thay bằng nhận định riêng.

**Bước 4: Validate trước khi chốt.**

Chỉ 1 topic/call; từ khóa tối đa 2 lần thử ("biển đông" → "south china sea") rồi chấp nhận "ít coverage". Không mở rộng sang nhiều cuộc chiến trong 1 run (user hỏi rộng thì đề nghị tách từng xung đột).

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Cường độ:** event counts GDELT trend (đơn vị counts + trend tăng/giảm) + URL.
2. **Giá đã phản ánh chưa:** dầu/vàng move vs baseline (đơn vị USD/thùng, USD/oz, % move) + URL.
3. **Kênh truyền dẫn:** energy → inflation → rates, 1–2 dòng + URL.
4. **Xác suất leo thang:** odds prob_pct (đơn vị %) + end-date + URL event.
5. **Hàm ý vị thế:** cushion/size (tham chiếu leg 6 `danh-gia-truoc-bctc`), KHÔNG khuyến nghị mua/bán trực tiếp.

## Ví dụ

**Ví dụ 1:**
Hỏi: Xung đột ảnh hưởng dầu/vàng
Trả lời: `geo_intel("Vietnam")` trả articles · `event_stats("vietnam")` articles >0 · gold <số> USD/oz cùng phiên → verdict đủ 5 mục, có số dầu/vàng phiên gần nhất.
