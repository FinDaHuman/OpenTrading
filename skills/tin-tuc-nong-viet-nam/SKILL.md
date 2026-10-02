---
name: tin-tuc-nong-viet-nam
description: Digest tin nóng trong ngày về thị trường/doanh nghiệp VN — headline, phân loại, sentiment.
when_to_use: "Tin chứng khoán hôm nay, có tin gì về VN30. Không dùng khi: tin theo từ khóa/mã cụ thể (tim-kiem-tin-tuc), tin thế giới (tin-tuc-nong-quoc-te)."
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 9
triggers:
  keywords: [tin nóng, tin chứng khoán, tin hôm nay, tin vn, tin doanh nghiệp, headline]
version: 1.0.0
---

# Tin nóng Việt Nam

## Workflow

| Wave | Tools |
|---|---|
| 1 | `news_market`(limit=15) · `corporate_calendar`(limit=20) |
| 2 | `news_symbol` × 2-3 mã xuất hiện nhiều nhất trong tin |
| 3 | `sentiment_score`(mã nóng nhất) · `company_events`(mã đó) |

## Verdict

5-7 headline, mỗi tin: tiêu đề + mã liên quan + phân loại (catalyst/đồn đoãi/tin vĩ mô) +
sentiment nếu đủ dữ kiện + provenance (Fireant/GDELT).

## Chống tràn lan

- Tối đa 3 mã đào thêm ở wave 2 (chọn theo tần suất xuất hiện, không theo cảm tính).
- `sentiment_score` heuristic fallback (thiếu Groq) → ghi nhãn "heuristic", không diễn giải thành "phố tin/bán".

## Lỗi thường gặp

Fireant chết → tự GDELT fallback (trong tool). Cả hai chết → `snapshot_history(kind=news_feed)`
đọc cache 1 ngày, GHI RÕ là cache.

## Bằng chứng live (02-10-2026)

Fireant posts 02-10 (quỹ bình ổn xăng dầu về KBNN; đất nền HN đổi tâm lý; chiến dịch làm
sạch mã số thuế) · `news_symbol("VCB")` → posts lãi suất 0.1-6%.

## Nghiệm thu

"Tin nóng hôm nay" → ≥5 headline có provenance, ≤9 calls.
