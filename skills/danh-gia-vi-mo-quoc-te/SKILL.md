---
name: danh-gia-vi-mo-quoc-te
description: "Reads the US business cycle and global risk state (soft/hard landing, yield curve, risk-on/off). Use for the US/global macro backdrop."
match_text: "Đọc chu kỳ kinh tế Mỹ và trạng thái rủi ro toàn cầu (soft/hard landing, đường cong lợi suất, risk-on/off). Dùng khi hỏi bối cảnh vĩ mô Mỹ/thế giới."
activation: auto
requires_tools: [mcp__opentrading__fred_series]
triggers:
  keywords: [kinh tế mỹ, recession, suy thoái kinh tế mỹ, đường cong lợi suất, yield curve, risk-on, risk-off, fed bối cảnh, kinh tế toàn cầu]
version: 1.6.0
---

# Vĩ mô Mỹ và toàn cầu

Go through 3 sequential waves (each wave parallel inside): the US cycle → the risk regime → global confirmation. Call FRED by standard names; without a key, switch to the non-FRED branch instead of dropping the whole verdict.

## Khi nào dùng

- Use when: the user asks about the US cycle (soft/hard landing), the yield curve, jobs/GDP across countries, the global risk regime, Vietnam vs the world.
- Do NOT use (use another skill instead):
  - Detailed Vietnamese macro (GDP/CPI/trade/SBV) → use `danh-gia-vi-mo-viet-nam`.
  - Pure Fed cut/hold/hike odds + the FOMC calendar → use `du-doan-fed`.

## Các bước

**Bước 1: The US cycle (in parallel).**

Run `fred_series` (DGS10) + `fred_series` (CPIAUCSL) + `yf_yield_curve`. NEVER go to web_search/web_fetch before the dedicated tools — the web only supplements once you have FRED figures. FRED without a key → unavailable → switch to the non-FRED branch (`yf_yield_curve` + `yf_global_indices`) + note honestly which series are missing. A flaky curve → retry at most once after a backoff, then drop it.

**Bước 2: Risk regime (in parallel, after Bước 1).**

Run `yf_regime_assets` + `assets_rotation` + `world_macro_country` (VN/CHINA per the question). At most 3 `yf_*` calls per wave; never overlap `yf_yield_curve` + `fred_series` for more than 1 round. If `world_macro_country` is empty, change the country code once, then accept "ít coverage".

**Bước 3: Global confirmation (in parallel, after Bước 2).**

Run `yf_global_indices` + `yf_commodities` + `world_fear_greed`. For a history of world indices, `vn_global_index` takes both Yahoo codes and common names (SPX, ^GSPC, S&P 500, Dow, Nasdaq, DAX, CAC 40…); Nasdaq-100 is not in this source — use `yf_global_indices`. Move to Bước 2 only once Bước 1 has DGS10 + CPI + the curve; calling ≥3 FRED series at once is a sign of sprawl → stop.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **US cycle:** soft/hard landing, based on DGS10 + CPI + the curve, in % yield + % CPI + URL.
2. **The curve:** inverted or not, the 10Y-2Y spread (bps/%) + URL.
3. **Global regime:** RISK-ON/OFF from rotation/regime assets + URL.
4. **Vietnam vs the world:** 1 required line comparing Vietnam's GDP (% WorldBank) with the world + URL.
5. **Variables to watch:** list US CPI, jobs and yields to watch next.

## Ví dụ

**Ví dụ 1:**
Hỏi: Kinh tế Mỹ hiện tại
Đạt khi: a verdict with all 5 items, the curve + ≥2 FRED series with figures.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: multiline 10Y/2Y, line CPI/curve, gauge fear/greed.
