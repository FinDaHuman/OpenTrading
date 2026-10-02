---
name: tim-kiem-tin-tuc
description: Tìm tin theo từ khóa/mã/phạm vi — 3 chế độ (mã / VN / toàn cầu), provenance từng tin.
when_to_use: "Tin về FPT, tin VN hôm nay, tin thế giới về dầu. Không dùng khi: digest tin nóng mặc định (tin-tuc-nong-viet-nam / tin-tuc-nong-quoc-te)."
activation: auto
requires_tools: [mcp__opentrading__news_symbol]
tool_budget: 10
triggers:
  keywords: [tin về, tìm tin, tin tức về, news về, tin trên, dư luận về]
version: 1.0.0
---

# Tìm kiếm tin tức

## Workflow theo chế độ

| Chế độ | Wave | Tools |
|---|---|---|
| **A. Theo mã** | 1 | `news_symbol(symbol, limit=10)` (Fireant-first, GDELT fallback trong tool) |
| | 2 (Fireant mỏng) | `corporate_calendar(symbol)` + `company_events(symbol)` |
| | 3 (đủ 5 tin CHẤT LƯỢNG → DỪNG) | `news_market`(tên công ty, gdelt) |
| | 4 (nếu hỏi dư luận) | `sentiment_score(symbol)` |
| **B. VN** | 1 | `news_market(limit=10)` + `corporate_calendar(limit=20)` |
| | 2 | `news_symbol` × 2-3 mã nổi bật nhất |
| **C. Toàn cầu** | 1 | `news_market(sources=gdelt, limit=10)` |
| | 2 | `geo_intel(topic)` hoặc `event_stats(query)` |
| | 3 (có key) | `web_search(query)` → `web_fetch` 1-2 nguồn chính thức |

## Verdict

Bảng tin {tiêu đề · ngày · nguồn · mã/tag liên quan · phân loại catalyst/đồn} + nguồn nào
đang chết (pre-flight). Tin đồn → ghi nhãn "chưa xác nhận", không diễn giải.

## Chống tràn lan

- Mode A không gọi `news_market` nếu `news_symbol` đã ≥5 tin đạt chuẩn.
- GDELT rỗng → THỬ từ khóa English 1 lần rồi kết luận "ít coverage ngôn ngữ đó".
- `web_search` ẩn khi thiếu key → degrade `web_fetch`, không retry.

## Lỗi thường gặp

Cả 2 nguồn news chết → `snapshot_history(kind=news_feed)` cache, GHI RÕ "cache <ngày>".
Fireant posts `id/user null` = đặc trưng payload, không phải lỗi.

## Bằng chứng live (02-10-2026)

`news_symbol("VCB")` → lãi suất VCB 0.1-6% posts · mode C "dầu" — GDELT articles live ·
corporate_calendar VCB → 487 docs.

## Nghiệm thu

3 input mẫu (mã/VN/global) → mỗi output ≥3 tin có provenance, ≤10 calls, không vượt 4 song song.
