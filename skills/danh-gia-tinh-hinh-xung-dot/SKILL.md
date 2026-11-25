---
name: danh-gia-tinh-hinh-xung-dot
description: "Assesses one conflict: intensity, whether oil/gold have priced it in, transmission channels, escalation probability. Use when asked how a war affects markets."
match_text: "Đánh giá một cuộc xung đột: cường độ, dầu/vàng đã phản ánh chưa, kênh tác động, xác suất leo thang. Dùng khi hỏi chiến sự ảnh hưởng thị trường."
activation: auto
requires_tools: [mcp__opentrading__event_stats]
triggers:
  keywords: [xung đột, chiến tranh, biển đông, trung đông, leo thang, dầu hay vàng lên, chiến sự]
version: 1.3.0
---

# Tác động của xung đột vũ trang

Answer 5 fixed items: intensity → what prices have priced in → transmission channels → escalation probability → positioning implications.

## Khi nào dùng

- Use when: the user names 1 specific conflict/war + asks about intensity, escalation, what prices reflect, transmission channels, positioning implications.
- Do NOT use (use another skill instead):
  - Broad politics/elections → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Unrest in 1 country (protests/a coup, not yet war) → use `bat-on-quoc-gia`.
  - Only plain odds → use `du-doan-polymarket`.

## Các bước

**Bước 1: Measure intensity (required, in parallel).**

Run `geo_intel` (conflict topic) + `event_stats` (query) together. Try keywords in both Vietnamese and English; an empty GDELT result for Vietnamese is a feature of the data (write "query VN rỗng, dùng EN query X", retry at most once in English), not an error.

**Bước 2: Check what prices reflect (in parallel, after Bước 1).**

Run `yf_commodities` (oil + gold) + `assets_rotation`. Without a new session, use the latest available one + state its date; never invent current prices. Bước 1 counts + Bước 2 oil/gold prices are enough for a basic verdict.

**Bước 2b: Military flight activity (oracle 8010 reference, 1 call).**

Run `geo_intel` with `military=true` — live military aircraft from adsb.lol (count, by_country, by_type), distance to the nearest conflict zone (km) and the signal-loss diff (aircraft vanishing near the zone = suspected transponders off, an OSINT signal). Reading: a high count + many tankers/recon near the zone → stepped-up activity; many "Unknown" operators → official traces lost. If the tool is down (adsb.lol 429/geo-block), say so honestly; never invent aircraft counts.

**Bước 3: Escalation odds + verification (only when needed).**

Run `world_prediction_odds` (keywords for the war) + `web_search`/`web_fetch` (only 1–2 sources). If there is no market for the war, write "không có odds"; never replace it with your own view.

**Bước 4: Validate before concluding.**

Only 1 topic per call; at most 2 keyword attempts ("biển đông" → "south china sea"), then accept "ít coverage". Never widen to several wars in 1 run (if the user asks broadly, suggest splitting by conflict).

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **Intensity:** GDELT event-count trend (counts + rising/falling) + URL.
2. **Priced in or not:** oil/gold move vs baseline (USD/barrel, USD/oz, % move) + URL.
3. **Transmission channel:** energy → inflation → rates, 1–2 lines + URL.
4. **Escalation probability:** odds prob_pct (%) + end-date + event URL.
5. **Positioning implications:** cushion/size (see leg 6 of `danh-gia-truoc-bctc`); a buy/sell/hold recommendation with its conditions only when the user asks for one and the figures above support it.

## Ví dụ

**Ví dụ 1:**
Hỏi: Xung đột ảnh hưởng dầu/vàng
Đạt khi: a verdict with all 5 items, with oil/gold figures from the latest session.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: line oil/gold, bar odds.
