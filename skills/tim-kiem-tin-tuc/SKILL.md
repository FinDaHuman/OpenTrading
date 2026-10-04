---
name: tim-kiem-tin-tuc
description: Tìm tin theo từ khóa/mã/phạm vi KỂ CẢ tin đồn — săn web + comments, đánh giá tuổi/độ tin/triển vọng, phân tích chi tiết tin.
when_to_use: "Tin về FPT, nghe đồn mã X..., tin VN hôm nay, tin thế giới về dầu. Không dùng khi: digest tin nóng mặc định (tin-tuc-nong-viet-nam / tin-tuc-nong-quoc-te)."
activation: auto
requires_tools: [mcp__opentrading__news_symbol]
tool_budget: 10
triggers:
  keywords: [tin về, tìm tin, tin tức về, news về, tin trên, dư luận về, nghe đồn, tin đồn, có thật không]
version: 1.1.0
---

# Tìm kiếm tin tức (kể cả rumor)

Rumor có TRƯỚC tin chính thống — skill này săn cả hai, nhưng phân loại rõ ràng.

## Workflow theo chế độ

| Chế độ | Wave | Tools |
|---|---|---|
| **A. Theo mã (+ rumor)** | 1 | `news_symbol`(symbol, limit=20) — Fireant-first |
| | 2. Săn web + comments | `web_search`("tên mã" + "đồn"/"tin đồn"/rumor) → `web_fetch` 1–2 URL đáng ngờ nhất · `fireant_thread`(post_id từ wave 1 — rumor nằm ở replies) |
| | 3. Đối chiếu | `corporate_calendar`(symbol) + `company_events`(symbol) — tin có khớp công bố không? |
| | 4. Dư luận | `sentiment_score`(symbol) |
| **B. VN** | 1 | `news_market`(limit=15) + `corporate_calendar`(limit=20) |
| | 2 | `news_symbol` × 2–3 mã nổi bật + `web_search` tin nóng nhất (xác minh chéo) |
| **C. Toàn cầu** | 1 | `news_market`(sources=gdelt, limit=10) |
| | 2 | `geo_intel`(topic) / `event_stats`(query) + `web_search`(từ khóa EN) |

## Verdict mỗi tin (4 cột bắt buộc)

Tiêu đề · **tuổi tin** (mấy giờ/ngày trước — tin cũ >3 ngày với bluechip coi như đã phản ánh giá) · **độ tin cậy** (chính thống / CTCK / Fireant-crowd / ẩn danh-nguồn mở) · **triển vọng** (tác động tới DN: doanh thu/lợi nhuận/giá — hay chỉ là noise). Tin đồn → nhãn "CHƯA XÁC NHẬN" + điều kiện xác nhận (chờ công bố nào, ngày nào).

## Phân tích chi tiết tin quan trọng nhất

Ai nói → nói gì → bằng chứng kèm theo → tác động định lượng được không (vd cổ tức bao nhiêu đồng, thương vụ bao nhiêu tỷ) → kịch bản nếu đúng/sai.

## Chống tràn lan

- Mode A dừng khi đã ≥5 tin đạt chuẩn; `web_search` tối đa 2 query/mode; không fetch quá 2 URL.
- GDELT rỗng → THỬ từ khóa English 1 lần rồi kết luận "ít coverage ngôn ngữ đó".
- `web_search` ẩn khi thiếu key → chỉ dùng Fireant+GDELT + ghi chú "chưa quét web".

## Lỗi thường gặp

Cả 2 nguồn news chết → `snapshot_history(kind=news_feed)` cache, GHI RÕ "cache <ngày>".
Fireant posts giờ CÓ id thật (parser postID, P17) — dùng `fireant_thread` đọc replies.

## Bằng chứng live (02-10-2026)

`news_symbol("VCB")` → lãi suất VCB 0.1-6% posts · GDELT "dầu" live · corporate VCB 487 docs ·
`fireant_thread`(post PNJ 42088453) → root + 2 replies thật.

## Nghiệm thu

"Nghe đồn HPG ... thật không" → verdict 4 cột + phân tích chi tiết + nhãn xác nhận, ≤10 calls.
