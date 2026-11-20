---
name: chu-ky-tai-san-vn
description: "Locates the VN multi-asset cycle phase (stocks, bonds, savings, gold, USD, derivatives) from cross-market flows, seasonality and SBV rates. Use when asked how money is moving between VN asset classes."
match_text: "Định vị pha chu kỳ đa tài sản VN (cổ phiếu, trái phiếu, tiết kiệm, vàng, USD, phái sinh) từ dòng tiền liên thị trường, mùa vụ và lãi suất SBV. Dùng khi hỏi tiền đang chảy giữa các lớp tài sản VN thế nào."
activation: auto
triggers:
  keywords: [tài sản việt nam, luân chuyển tiền, dòng tiền liên thị trường, lãi suất tiết kiệm, trái phiếu doanh nghiệp, maturity wall, basis phái sinh, tiền rẻ, stagflation việt nam]
requires_tools: [vn_asset_check]
uses_tools: [vn_asset_check, vn_asset_seasonality, vn_asset_anchors, vn_asset_chains, vn_index_ohlcv, vn_futures_ohlcv, sbv_rates, breadth_scan]
version: 1.1.0
---

# Chu kỳ tài sản Việt Nam (multi-asset)

This skill infers Vietnam's monetary/asset phase from 6 price series (VNINDEX, gold, USDVND, RON95 petrol, BTC, Brent) + periodic report anchors (deposit rates, government bond yields, corporate bond maturities, the SJC spread, foreign flows). The data lives in PG (`vn_asset_*`) and is read through tools — this file keeps only the logic. Stock-sector detail → cross-ref the `dinh-vi-chu-ky-vn` skill.

## Khi nào dùng

- Use when: the user asks where money is flowing between stocks/savings/gold/USD/bonds, what the SJC spread says, whether the corporate bond maturity wall is dangerous, what the futures basis signals, where to take shelter.
- Do NOT use (use another skill instead):
  - Stock-sector wave detail → use `dinh-vi-chu-ky-vn`.
  - GDP/CPI/trade figures → use `danh-gia-vi-mo-viet-nam`.
  - Strategy backtests → use `kiem-chien-luoc-backtest`.
  - Global assets → use `chu-ky-tai-san-the-gioi`.

## Các bước

**Bước 0: Check freshness.**

Call `vn_asset_check`.
- Empty `as_of` or a table with no rows → **no data yet**: stop, say "chưa có dữ liệu chu kỳ trên server", conclude no phase, never substitute any number from `references/`.
- Stale (>90 days) → warn + suggest a refresh per `references/refresh.md` (a write tool, found with `tool_search`; run it only if the user agrees). Never conclude with certainty on an old table.

**Bước 1: Read cross-market flows (in parallel).**

Read `vn_asset_seasonality` for the current month for VNINDEX/GOLD_W/USDVND/RON95/BTC/BRENT + `vn_asset_anchors` (deposit rates, government bond yields, the corporate bond wall, the SJC spread, foreign flows). Assemble the money cycle: cheap money (low deposit rates, SBV easing) → stocks; hot stocks + tight USD + a widening SJC spread → Overheat (gold/USD/real estate); corporate bond wall + margin stress → distribution; recession → savings/USD/gold.

**Bước 2: Leading signals (sequential).**

Read `vn_asset_chains`: a strong BTC month and rising Brent are the 2 leading signals in the table (check the hit rate and sample size in the tool result before using them). USD/gold are read only for the same period, never to forecast (a weakening dong + foreign selling = lower stock weighting).

**Bước 3: Seasonality + events (in parallel).**

For the current month read `vn_asset_seasonality` (numbers from the table, never months from memory). VN30F1M basis if needed: `vn_futures_ohlcv` (VN30F1M) minus `vn_index_ohlcv` (VN30) for the same session; a deep discount + high liquidity = a bottoming zone.

**Bước 4: Conclude the phase + suggest asset classes.**

A 1-line verdict + confidence + evidence (every number with tool provenance) + 1–2 suggested classes. NEVER pick specific tickers. Anchors (corporate bond wall, SJC spread, deposit rates) always cite their source from `vn_asset_anchors`.

## Cấu trúc câu trả lời

Table freshness · phase verdict · flow evidence (anchors with sources) · suggested classes · caveats (anchors are periodic reports, not daily; no public aggregate margin data exists).

## File tham khảo

| File | Answers |
|---|---|
| `references/flow-map.md` | Vietnam's money rotation cycle + trigger thresholds for each link |
| `references/anchors-guide.md` | Reading anchors (corporate bond wall, SJC spread, deposit rates, foreign) + provenance |
| `references/refresh.md` | When + how to refresh via tools + changelog |
