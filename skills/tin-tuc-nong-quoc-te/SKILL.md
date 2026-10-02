---
name: tin-tuc-nong-quoc-te
description: Tin thế giới tác động thị trường + market reaction xác nhận bằng số.
when_to_use: "Tin quốc tế, thị trường Mỹ/Trung hôm nay. Không dùng khi: tin VN (tin-tuc-nong-viet-nam), từ khóa riêng (tim-kiem-tin-tuc chế độ C)."
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 8
triggers:
  keywords: [tin quốc tế, tin thế giới, thị trường mỹ, fed tin, wall street, nasdaq]
version: 1.0.0
---

# Tin nóng quốc tế

## Workflow

| Wave | Tools |
|---|---|
| 1 | `news_market(sources=gdelt)` · `geo_intel`(không topic = global coverage) |
| 2 | `yf_mega_flows` · `world_fear_greed` |
| 3 | `event_stats`(từ khóa tin nổi bật nhất) |

## Verdict

5 headline + market reaction xác nhận bằng SỐ (mega-cap flows, fear/greed, curve nếu liên
quan rates) — tin chưa có reaction thì ghi "thị trường chưa phản ánh".

## Bằng chứng live (02-10-2026)

mega_flows AAPL/MSFT/NVDA OK · fear/greed 70-74 Greed 7 ngày.

## Nghiệm thu

"Tin thế giới" → ≥5 headline + ≥2 mục reaction định lượng.
