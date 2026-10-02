---
name: danh-gia-tinh-hinh-chinh-tri-toan-cau
description: Bản đồ rủi ro chính trị toàn cầu — bầu cử, chính sách, căng thẳng quốc tế, ghép xác suất + tin.
when_to_use: "Địa chính trị tuần này, bầu cử Brazil, rủi ro chính sách. Không dùng khi: xung đột vũ trang cụ thể (danh-gia-tinh-hinh-xung-dot), bất ổn 1 nước (bat-on-quoc-gia), chỉ xin odds (du-doan-polymarket), Fed (du-doan-fed)."
activation: auto
tool_budget: 8
triggers:
  keywords: [địa chính trị, bầu cử, chính trị, chính sách trump, căng thẳng quốc tế, rủi ro chính trị]
version: 1.0.0
---

# Đánh giá tình hình chính trị toàn cầu

Skill tổ chức — không home tool riêng, dùng cross-ref (design, không phải vi phạm).

## Workflow

| Wave | Tools |
|---|---|
| 1 | `world_prediction_odds`(tag=fed/politics/elections theo câu hỏi) · `geo_intel`(topic) |
| 2 | `polymarket_event`(slug top 1-2) · `event_stats`(query) |
| 3 | `news_market(sources=gdelt)` · `web_fetch`(1-2 nguồn chính thức trong tin) |

## Verdict

Bản đồ rủi ro 4-6 mục: sự kiện + xác suất (prob_pct) + volume thanh khoản (độ tin của odds)
+ tin GDELT xác nhận + market-impact nếu có.

## Chống tràn lan

- Odds đã sort vol24h — lấy top 5, không kéo cả 20 event.
- `polymarket_event` chỉ cho event THẬT SỰ liên quan câu hỏi.

## Lỗi thường gặp

GDELT rate-limit (đã gặp live) → backoff 20s → 1 lần. Gamma proxy chậm → fallback direct, chờ 1 lần.

## Bằng chứng live (02-10-2026)

Fed October 2026: "no change" **74.5%** (volume 24h ~2.6M USD) · Brazil presidential event OK.

## Nghiệm thu

"Rủi ro chính trị toàn cầu" → ≥4 mục có prob_pct + provenance event URL.
