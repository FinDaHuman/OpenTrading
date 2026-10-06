---
name: tin-tuc-nong-quoc-te
description: "Tóm tắt 5 tin thế giới tác động thị trường, kèm phản ứng giá xác nhận bằng số. Dùng khi hỏi tin quốc tế, Mỹ, Trung Quốc hôm nay."
activation: auto
requires_tools: [mcp__opentrading__news_market]
triggers:
  keywords: [tin quốc tế, tin thế giới, thị trường mỹ, fed tin, wall street, nasdaq]
version: 1.3.0
---

# Tin nóng quốc tế

Tin thế giới + market reaction xác nhận bằng SỐ — không đưa tin suông. Tin chưa có reaction thì bắt buộc ghi "thị trường chưa phản ánh", không bịa reaction. Tin đồn quốc tế bắt buộc nhãn `CHƯA XÁC NHẬN`.

## Khi nào dùng

- Dùng khi: tin quốc tế/Mỹ/Trung, Fed, Wall Street, cần headline + số liệu thị trường xác nhận.
- Khi KHÔNG dùng (dùng skill khác thay thế): tin VN → `tin-tuc-nong-viet-nam`; từ khóa riêng/rumor → `tim-kiem-tin-tuc` chế độ C; vĩ mô chuyên sâu (curve, flows, fear/greed riêng lẻ) → `danh-gia-vi-mo-quoc-te`; crypto → `nhip-dap-crypto`.

## Các bước

**Bước 1: Tin global (song song).**

Chạy `news_market` (sources=gdelt) + `geo_intel` (không topic = global coverage). Không tự thêm topic hẹp nếu user hỏi chung. GDELT rỗng → thử từ khóa English 1 lần rồi kết luận "ít coverage".

**Bước 2: Reaction bằng số (song song, tuần tự sau Bước 1 để soi đúng tin).**

Chạy `yf_mega_flows` + `world_fear_greed`.

**Bước 3: Xác minh 1 tin nổi bật nhất (tuần tự).**

Chạy `event_stats` cho đúng 1 từ khóa nổi bật nhất, không chạy cho mọi headline. Cả 2 nguồn news chết → đọc `snapshot_history` (kind=news_feed), bắt buộc ghi rõ "cache <ngày>". Feed rỗng cuối tuần → empty hợp lệ, ghi rõ phiên nghỉ.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau: 5 headline, mỗi tin gồm **tiêu đề + tuổi tin + provenance** (GDELT/`geo_intel`) + **market reaction bằng SỐ** (mega-cap flows, fear/greed, curve nếu liên quan rates).

## Ví dụ

**Ví dụ 1:**
Hỏi: Tin thế giới
Trả lời: mega_flows AAPL/MSFT/NVDA OK · fear/greed <số> Greed 7 ngày → ≥5 headline + ≥2 mục reaction định lượng, ≤8 calls. Thiếu reaction số mà không ghi "thị trường chưa phản ánh" → chưa đạt.
