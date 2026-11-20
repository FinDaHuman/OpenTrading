---
name: bat-on-quoc-gia
description: "Rates the political stability of ONE country on a 4-level scale, with evidence. Use when asked whether a country faces unrest, protests or a coup."
match_text: "Chấm độ ổn định chính trị của MỘT nước theo thang 4 mức, có bằng chứng. Dùng khi hỏi một nước có bất ổn, biểu tình, đảo chính không."
activation: auto
requires_tools: [mcp__opentrading__geo_intel]
triggers:
  keywords: [bất ổn, bất ổn quốc gia, biểu tình, đảo chính, ổn định chính trị]
version: 1.3.0
---

# Đánh giá độ ổn định của một quốc gia

Assess 1 country on the scale ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG, each level with evidence and a URL. For several countries, run this skill once per country instead of merging.

## Khi nào dùng

- Use when: the user names ONE country + asks about instability/stability/protests/a coup.
- Do NOT use (use another skill instead):
  - Comparing/mapping several countries, global elections/policy → `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - War/armed conflict + market impact → `danh-gia-tinh-hinh-xung-dot`.

## Các bước

**Bước 1: Measure intensity (required).**

Run 2 calls in parallel on the same GDELT upstream: `geo_intel` (topic = the country's English name) + `event_stats` (query = the country's English name). `geo_intel` already filters political news (drops sport/noise) and returns an aggregate (count/by_day/top_sources); `event_stats` returns a base-rate aggregate — use geo_intel for articles, event_stats for counts vs the baseline. NEVER go to web_search/web_fetch before you have the GDELT counts — the web is only for Bước 2 when Bước 1 is thin. One English query + at most 1 variant; an empty Vietnamese query is a feature of the data, not an error. GDELT rate-limited → retry at most once after a backoff (the server caches 600s); if it still fails, say so honestly and base the verdict on older data.

**Bước 2: Verify with news (only when Bước 1 is thin).**

Run `news_market` (sources=gdelt, filtered by country name) sequentially after Bước 1. If Bước 1 has enough counts + titles, stop; skip Bước 2. Thin coverage is a RESULT ("low-coverage ≠ stable"); never infer ỔN ĐỊNH from it.

**Bước 3: Settle the verdict.**

Add `yf_commodities` or `assets_rotation` (1 call) only when the user explicitly asks about "ảnh hưởng thị trường". At most 6 calls per run, since every extra call costs quota and dilutes the verdict — stop as soon as the evidence is enough.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **4-level verdict (pick exactly 1):** ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG.
2. **Grounds (1 line + URL each):** GDELT event frequency (this run is the baseline) · severity (protest/conflict/coup keywords in titles) · coverage of neighbouring countries · transmission to prices if the extra step ran (oil/gold, in USD/oz or % move).
3. **Provenance:** every item must have 1 line of evidence + a source URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Bất ổn Thái Lan
Trả lời:
```
Verdict: CẢNH BÁO
- Tần suất event GDELT tăng vs baseline ... + URL
- Mức độ: keywords protest xuất hiện ... + URL
- Coverage nước láng giềng: ...
Provenance: (1 dòng evidence + URL cho mỗi mục trên)
```

**Ví dụ 2:**
Hỏi: Bất ổn Lào
Trả lời: a verdict with the honest note "low-coverage ≠ stable", never inferring ỔN ĐỊNH.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: line event counts, line oil/gold.
