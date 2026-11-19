---
name: tin-tuc-nong-quoc-te
description: "Summarises 5 world news items moving markets, with the price reaction confirmed in numbers. Use for today's international, US or China news."
match_text: "Tóm tắt 5 tin thế giới tác động thị trường, kèm phản ứng giá xác nhận bằng số. Dùng khi hỏi tin quốc tế, Mỹ, Trung Quốc hôm nay."
activation: auto
requires_tools: [mcp__opentrading__news_market]
triggers:
  keywords: [tin quốc tế, tin thế giới, thị trường mỹ, fed tin, wall street, nasdaq]
version: 1.3.0
---

# Tin nóng quốc tế

World news + market reaction confirmed in NUMBERS — never bare headlines. A story with no reaction yet must be marked "thị trường chưa phản ánh"; never invent a reaction. International rumours must carry the label `CHƯA XÁC NHẬN`.

## Khi nào dùng

- Use when: international/US/China news, the Fed, Wall Street, when headlines + confirming market figures are needed.
- Do NOT use (use another skill instead): Vietnamese news → `tin-tuc-nong-viet-nam`; a specific keyword/rumour → `tim-kiem-tin-tuc` mode C; in-depth macro (curve, flows, fear/greed alone) → `danh-gia-vi-mo-quoc-te`; crypto → `nhip-dap-crypto`.

## Các bước

**Bước 1: Global news (in parallel).**

Run `news_market` (sources=gdelt) + `geo_intel` (no topic = global coverage). Do not add a narrow topic if the user asked generally. If GDELT is empty → try English keywords once, then conclude "ít coverage".

**Bước 2: Reaction in numbers (in parallel, after Bước 1 so you check the right stories).**

Run `yf_mega_flows` + `world_fear_greed`.

**Bước 3: Verify the single most prominent story (sequential).**

Run `event_stats` for exactly 1 most prominent keyword, not for every headline. If both news sources are down → read `snapshot_history` (kind=news_feed) and state "cache <ngày>" explicitly. An empty feed at the weekend is a valid empty; state that markets are closed.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure: 5 headlines, each with **title + age + provenance** (GDELT/`geo_intel`) + **market reaction in NUMBERS** (mega-cap flows, fear/greed, the curve if rates are involved).

## Ví dụ

**Ví dụ 1:**
Hỏi: Tin thế giới
Đạt khi: ≥5 headlines + ≥2 market-reaction items with numbers, ≤8 calls. Missing reaction numbers without writing "thị trường chưa phản ánh" → not met.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of the tool result) so you never retype numbers; load `ve-bieu-do` when you need to choose a chart type.
