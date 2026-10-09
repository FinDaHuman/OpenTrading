---
name: phan-tich-sentiment
description: "Đo dư luận về một mã trên Fireant: điểm sentiment, trích dẫn, cảnh báo FOMO. Dùng khi hỏi nhà đầu tư đang nói gì về một mã."
activation: auto
requires_tools: [mcp__opentrading__sentiment_score]
triggers:
  keywords: [sentiment, dư luận, phố nói gì, crowd, fomo, tâm lý nhà đầu tư, comment]
version: 1.3.0
---

# Đo tâm lý đám đông về một mã

Đo *đám đông*, không đo *doanh nghiệp* — crowd có thể sai, sentiment không bao giờ là leg duy nhất của quyết định. Chỉ 1 symbol/run; limit 20 đủ 90% mẫu, không nới limit.

## Khi nào dùng

- Dùng khi: hỏi dư luận/crowd/FOMO/comment về 1 mã cụ thể trên Fireant.
- Khi KHÔNG dùng (dùng skill khác thay thế): tin chính thống/rumor → `tim-kiem-tin-tuc`; fear/greed chung → `danh-gia-vi-mo-quoc-te` / `nhip-dap-crypto`; rating CTCK → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 1: Top 20 posts + điểm + comments (song song).**

Chạy `sentiment_score` (symbol, limit=20) — điểm + posts từ Fireant. Chạy `news_symbol`/Fireant posts (limit=20) đọc title/summary top 20. Chọn post nóng nhất (interact/comment cao nhất) → chạy `fireant_thread` (post_id) lấy comments (replies) thực tế — đọc mood comments, không chỉ đọc điểm. Đủ điểm + ≥3 quotes + comments ≥3 + nhãn nguồn thì dừng.

**Bước 2: Đối chiếu công bố (chỉ khi mâu thuẫn, tuần tự).**

Chạy `company_events` (symbol) khi comment contradicts disclosures. Không dùng sentiment để "chốt luận" — chỉ confirm/deny.

**Bước 3: Validate trước khi chốt.**

Thiếu Groq → `score_heuristic` + warning "groq unavailable" → bắt buộc nhãn `heuristic` trong verdict (heuristic thang khác, không chuẩn hóa chéo 2 mode Groq/heuristic). Posts rỗng = mã ít bàn (empty hợp lệ), không bịa quotes, ghi rõ "ít bàn luận". Fireant chết → fallback duy nhất: GDELT titles qua `tim-kiem-tin-tuc` (1 call), ghi rõ nguồn thay thế. Không diễn giải heuristic thành "nên mua/bán".

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

- **Điểm sentiment** (Groq hoặc heuristic — bắt buộc ghi nhãn nguồn).
- **3–5 trích comment tiêu biểu** (positive / negative / repeat-thuyết) + provenance Fireant.
- **Nhận diện FOMO/hoảng loạn** (tần suất symbol tag + likes); ngưỡng heuristic: <−0.3 hoảng loạn · >+0.3 FOMO · giữa = trung tính.
- **Cảnh báo vòng lặp bắt buộc:** crowd có thể sai — sentiment không được là leg duy nhất của quyết định.

## Ví dụ

**Ví dụ 1:**
Hỏi: Phố nói gì về FPT
Trả lời: FPT — 20 posts, heuristic **<số>**, trong khi M <số> sạch (điển hình crowd≠fundamentals) · VCB posts lãi suất <số><số> → điểm + ≥3 quotes + nhãn nguồn, ≤4 calls. Thiếu nhãn nguồn hoặc thiếu cảnh báo vòng lặp thì chưa đạt.

## Trực quan hóa

Dữ liệu skill này nhận: sentiment score ±. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (gauge score), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
