---
name: chu-ky-tai-san-the-gioi
description: "Locates the global asset-cycle phase (stocks, bonds, commodities, gold, USD, BTC) from returns by phase, the stock–bond correlation and big funds' outlooks. Use for global allocation."
match_text: "Định vị pha chu kỳ tài sản toàn cầu (cổ phiếu, trái phiếu, hàng hoá, vàng, USD, BTC) từ lợi suất theo pha, tương quan cổ phiếu–trái phiếu và outlook các quỹ lớn. Dùng khi hỏi phân bổ tài sản toàn cầu."
activation: auto
triggers:
  keywords: [tài sản toàn cầu, global allocation, investment clock, stock bond correlation, suy thoái mỹ, recession mỹ, nber, all weather, risk parity, outlook jpmorgan blackrock, overweight underweight]
requires_tools: [g_asset_check]
uses_tools: [g_asset_check, g_asset_seasonality, g_asset_phase, g_asset_corr, g_asset_outlook]
version: 1.1.0
---

# Chu kỳ tài sản toàn cầu (multi-asset)

This skill infers the global phase from the ML Clock + NBER recession dates + 17 ETFs representing asset groups. The data lives in PG (`g_asset_*`) and is read through tools — this file keeps only the logic.

## Khi nào dùng

- Use when: the user asks about global asset allocation, whether the US is in recession, which stock-bond correlation regime holds, big banks'/funds' outlooks, which groups lead in each NBER phase.
- Do NOT use (use another skill instead):
  - Vietnamese assets → use `chu-ky-tai-san-vn` / `dinh-vi-chu-ky-vn`.
  - Pure Fed policy odds → use `du-doan-fed`.
  - Detailed international macro → use `danh-gia-vi-mo-quoc-te`.

## Các bước

**Bước 0: Check freshness.**

Call `g_asset_check`.
- Empty `as_of` or a table with no rows → **no data yet**: stop, say "chưa có dữ liệu chu kỳ trên server", conclude no phase, and never substitute any number from `references/`.
- Stale (>90 days) → warn + suggest a refresh per `references/refresh.md` (a write tool, found with `tool_search`; run it only if the user agrees).
- The outlook (`g_asset_outlook`) is updated by hand each quarter — always give the quarter of a view you quote; if the table is empty, skip Bước 3.

**Bước 1: Determine the phase (in parallel).**

Read `g_asset_phase`: compare returns by phase Early/Late/Mid/Recession, taking numbers from the table. **Required caveat**: Early/Late/Recession currently have only 1 recession (2020) in the data, a very small sample — only the Mid phase has enough samples to trust; never call the other phases' results "verified". Read `g_asset_corr(regime="post22")` for the current stock-bond correlation (positive since 2022 = bonds no longer hedge well).

**Bước 2: Seasonality + events (in parallel).**

Read `g_asset_seasonality(month=<M>)` for the current month; take numbers from the table, never strong/weak months from memory.

**Bước 3: Compare with the street (in parallel).**

Read the latest `g_asset_outlook` views (JPM/BlackRock/GS/MS/BofA/PIMCO...): which groups are overweight/underweight (OW/UW), which numeric targets, which quarter. The street is a counterweight to the statistics, not the truth — give both when they conflict.

**Bước 4: Conclude the allocation tilt.**

Phase verdict + allocation tilt (over/underweight by group; no specific tickers/ETFs unless the user asks) + evidence (tool provenance) + the thin-NBER caveat + the current regime.

## Cấu trúc câu trả lời

Table freshness + outlook quarter · phase verdict · evidence (phase table + corr regime + seasonality) · suggested tilt · comparison with the street (agreeing + conflicting) · the small NBER sample caveat.

## File tham khảo

| File | Answers |
|---|---|
| `references/ml-clock.md` | The 4 ML Clock phases + asset mapping + known limits |
| `references/regime-guide.md` | Reading corr regimes (pre22/post22), the stock-bond flip, BTC-gold spikes |
| `references/refresh.md` | When + how to refresh via tools + changelog |
