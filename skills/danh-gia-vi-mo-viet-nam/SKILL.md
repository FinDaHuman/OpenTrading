---
name: danh-gia-vi-mo-viet-nam
description: "Reads VN macro: GDP, CPI, trade, exchange rate, SBV rates, the driving narrative and the release calendar. Use for VN macro figures or backdrop."
match_text: "Đọc vĩ mô Việt Nam: GDP, CPI, XNK, tỷ giá, lãi suất SBV, câu chuyện dẫn dắt và lịch công bố. Dùng khi hỏi số liệu hoặc bối cảnh vĩ mô VN."
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân, câu chuyện thị trường]
  # A trade question about one sector or product group belongs to xuat-nhap-khau-vn.
  exclude_keywords: [ngành xuất nhập khẩu, ngành xuất khẩu, nhóm hàng]
version: 1.6.1
---

# Vĩ mô Việt Nam

You must open with a 2-call pre-flight (source_status + vs_auth_status), since Vietnamese macro depends on a JWT and a HAR session that die easily. Call GDP, CPI, exports by `indicator`; the server fills in the id pair.

## Khi nào dùng

- Use when: the user asks for Vietnamese figures (GDP/CPI/exports/imports), SBV rates, USDVND in a macro context, the NSO release calendar, brokerages' macro reports, the narrative driving the Vietnamese market.
- Do NOT use (use another skill instead):
  - US/global macro, Fed context, risk regime → use `danh-gia-vi-mo-quoc-te`.
  - Pure Fed cut/hold odds → use `du-doan-fed`.
  - Detailed gold/FX work → use `phan-tich-vang-ty-gia`.

## Các bước

**Bước 0: Pre-flight (in parallel, required).**

Run `source_status` + `vs_auth_status` before any wave.

**Bước 1: Required Vietnamese data.**

In parallel, `vs_indicator_data` with `indicator` = "GDP", "CPI", "XK" and `vs_xnk_detail` (only 1 direction, exports or imports, per the question). Other indicators: take `category_id` + `term_type_id` from `vs_categories` (the pair must match; a wrong pair gives empty rows). Empty rows → retry at most once → still empty, write "không có số liệu kỳ này".

**Bước 2: Macro news (in parallel).**

Run `news_market` (filtered for macro/rates/FX) + `macro_events_vn` + `economic_calendar`.

**Bước 3: Brokerage reports (a single call).**

Run `analyst_consensus` (report_type=macro, limit=30) on the general feed; take section pointers + dated reports. Never fire one call per keyword.

**Bước 4: Extra data + calendar (in parallel, at most 1 call each).**

Run `snapshot_history` (macro_curated) + `yf_yield_curve` + `sbv_rates` + `vn_retail_fx` + `macro_events_vn` (NSO) + Fed/US meetings (cross-ref `du-doan-fed`). Without a HAR session, macro returns a permission message: state honestly "macro cần session", fall back to `snapshot_history`, and never read the permission message as data. A flaky curve/DXY → retry once after a backoff, then drop it.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **Growth:** GDP, ≥8 latest points, in % yoy + URL/provenance.
2. **Inflation:** CPI, ≥8 latest points, in % yoy + URL.
3. **Trade:** exports/imports/trade detail, in million USD + URL.
4. **Exchange rate:** USDVND (VND), SBV rates (refinancing/rediscount, %) + URL.
5. **Interest rates:** the SBV policy rate + the foreign-capital backdrop (curve/DXY) + URL.
6. **Positives / negatives + outlook.**
7. **The narrative driving the market + the event calendar** (for each story: which event, which date, what impact).

## Ví dụ

**Ví dụ 1:**
Hỏi: Vĩ mô VN
Đạt khi: a verdict with all 6 items + a driving narrative with an event calendar, ≤12 calls.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: line GDP/CPI + times, bar diverging XNK, bar rates.
