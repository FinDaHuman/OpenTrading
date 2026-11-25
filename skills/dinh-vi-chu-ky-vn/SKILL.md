---
name: dinh-vi-chu-ky-vn
description: "Locates the VN market phase (recovery, mid-wave, late wave, weakening) from sector relative strength (Vin included), seasonality and SBV rates; suggests 1–2 groups that may lead next. Use for market stage or the next sector wave."
match_text: "Định vị pha thị trường VN (phục hồi, giữa sóng, cuối sóng, suy yếu) từ sức mạnh tương đối các nhóm ngành (kể cả Vin), mùa vụ và lãi suất SBV, rồi gợi ý 1–2 nhóm có thể dẫn dắt tiếp. Dùng khi hỏi thị trường đang ở giai đoạn nào, sóng ngành tiếp theo."
activation: auto
triggers:
  keywords: [giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng tiếp theo, đầu sóng, chu kỳ thị trường, giai đoạn thị trường, pha thị trường, luân chuyển ngành, rotation, sóng ngành, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, bank dẫn, chứng dẫn, dòng tiền ngành, cuối sóng, giữa sóng, mùa vụ ngành, mảng vin, họ vin]
requires_tools: [cycle_stats_check, vn_index_ohlcv]
uses_tools: [cycle_stats_check, cycle_seasonality, cycle_chains, cycle_turning, cycle_tet, cycle_yearly, cycle_trough_events, vn_index_ohlcv, seasonality, sbv_rates, breadth_scan, market_movers, market_candles_batch, event_study, sector_performance]
version: 1.8.0
---

# Định vị pha chu kỳ thị trường Việt Nam

This skill infers the current phase from 4 live pillars (sector RS, peak timing, monthly seasonality, monetary conditions) + long-run statistics tables in PG (`cycle_*`, versioned in `cycle_meta`). Conclusions always carry the hit rate and provenance; never state them with certainty.

**This skill's scope is PHASES and SECTOR ROTATION.** Analysing a sector by its own drivers/KPIs/
valuation belongs to the 13 sector skills — table below. Neither side encroaches on the other:
sector skills do not determine phases, and this skill does not read sector KPIs.

## Khi nào dùng

- Use when: the user asks which stage/phase the market is in, which sector wave leads next, whether this is the end of a wave/distribution, which groups to favour by the cycle.
- Do NOT use (use another skill instead):
  - Detailed Vietnamese macro figures (GDP/CPI/trade/policy rates) → use `danh-gia-vi-mo-viet-nam`.
  - Backtesting a specific trading strategy → use `kiem-chien-luoc-backtest`.
  - Technicals of 1 ticker/1 chart → use `ky-thuat-chuyen-sau`.
  - Vietnam's multi-asset cycle (gold/USD/bonds/petrol) → use `chu-ky-tai-san-vn`.
  - Only wanting to SEE an RS chart/heatmap → use `ve-bieu-do`.

## Bản đồ skill ngành (13 skill — định tuyến khi user hỏi đúng ngành)

Each sector skill reads its sector through its own drivers + KPIs and does **not** determine the phase.
"ngành X đang thế nào" / "BCTC ngành X đọc gì" / "driver của X là gì" → use the
sector skill below. "thị trường đang ở pha nào / mảng nào dẫn tiếp" → stay in
this skill.

| Sector skill | Use for questions about |
|---|---|
| `ngan-hang-vn` | credit quotas, the net interest spread, NPLs/group 2 loans, banks' liquidity ratios |
| `chung-khoan-vn` | margin debt, brokerage leverage, the 4-business revenue mix |
| `bat-dong-san-vn` | real-estate credit, the bond channel and maturity wall, housing vs industrial parks |
| `thep-vn` | the ore–coking coal spread, the hot-rolled coil mix, steel trade defence |
| `dau-khi-vn` | oil prices, shipping routes/tonne-miles, the 5 oil & gas business loops |
| `dien-luc-vn` | electricity prices and retail tariff reform, generation mix, hydrology, grid development plans |
| `van-tai-vn` | route freight rates, port capacity, rate-locking share, export demand |
| `hoa-chat-vn` | the urea/fertiliser price cycle, China's export policy, export share |
| `tieu-dung-ban-le-vn` | real retail sales (inflation removed), household income, modern-retail penetration |
| `cong-nghe-vn` | signed revenue/backlog, the domestic–foreign split, revenue per employee |
| `bao-hiem-vn` | new insurance premiums, underwriting vs financial income, channel mix |
| `vingroup-vn` | SOTP by segment, the EV cash-burn loop, related-party transactions, the Vin group's index weight |
| `xuat-nhap-khau-vn` | two-layer tariffs, product mix, machinery imports as a leading indicator, foreign capital flows |

## Các bước

**Bước 0: Check freshness (required, first).**

Call `cycle_stats_check`.
- Empty `as_of` or `cached_symbols` = 0 → the tables **have no data yet**: stop, say "chưa có dữ liệu chu kỳ trên server", conclude no phase, never substitute any number from `references/`.
- `needs_refresh` true, or just after Tết with the Tết table not updated → warn + suggest a refresh per `references/refresh.md` (run it only if the user agrees). Never conclude a phase with certainty on old tables. Watch for the warning "cấu hình cũ (members_version=...)" — that table was computed from an older sector list and must be refreshed + finalised before use.

**Bước 1: Live sector RS (in parallel).**

Run `vn_index_ohlcv` for VNINDEX + VN30 + VNFIN + VNREAL + VNUTI + VNMAT + VNIT (count=64, interval=1D: the first candle is the price 63 sessions ago, the last is the latest session; long tables are cut in the middle but always keep the first and last candles; do not use summary), at most 3 indices per round so as not to overload the server. Compute 3-month RS (≈63 candles) for each sector index vs VNINDEX = sector index % change − VNINDEX % change; state the start/end dates used. The Vin group has no index of its own: run `market_candles_batch` for VIC, VHM, VRE, VPL (days=64), then compute 3-month RS as the average % change of the 4 tickers minus VNINDEX (state the method and which tickers lack candles). Compare with the RS reading rules in `references/rotation-chains.md` + look up `cycle_trough_events` against post-trough recovery patterns. In parallel run `market_movers` + `breadth_scan` (a real wave needs breadth > 50%). For a quick read of which groups are strong, `sector_performance` (the GICS heatmap) can be compared — but the main RS is computed as above from the start/end closes of the 63-session window (each sector index and VNINDEX: 4 numbers, dates stated), all indices in one `shell` command; this skill's RS never comes from the heatmap.

The `basket` parameter of the `cycle_*` tools accepts Vietnamese names without diacritics ("bất động sản", "dầu khí", "CNTT"...) — the full sector list is in the `cycle_seasonality` tool description; no need to copy it into the answer.

**Bước 2: Peak timing (sequential, after Bước 1).**

Look up `cycle_turning` for the latest VNFIN peak vs VNINDEX + the live peak from the Bước 1 data. Apply the timing rules in `references/rotation-chains.md`. Suspecting a peak zone → run `event_study` around the peak to measure the post-peak CAR.

**Bước 3: The current month's seasonality (in parallel).**

Look up `cycle_seasonality(month=<M>)` (bias + hit rate per group, precomputed in the PG table) + call `seasonality` for VNINDEX (computed directly from candles, one ticker only) to confirm the bias still holds. The two tools may differ because of different data periods: state which number comes from which tool. Within ±10 sessions of Tết → look up `cycle_tet` (pre-Tết banks/retail/transport; post-Tết steel/chemicals/transport/oil & gas).

**Bước 4: Monetary conditions (in parallel).**

Run `sbv_rates`. Easing = supports Phases 1–2; tightening/holding high + bill absorption = supports Phases 3–4. For deeper GDP/credit figures → cross-ref the `danh-gia-vi-mo-viet-nam` skill; never infer macro yourself.

**Bước 5: Conclude the phase + suggest groups.**

Score the 4 pillars with the checklist in `references/phase-playbook.md` and pick the phase with the most matches. Suggest the next 1–2 groups: look up `cycle_chains` for the LATEST hit rates (never the numbers in the file). Vin group: apply exactly the Vin condition in `references/rotation-chains.md` §1 (one single rule; do not derive other thresholds); outside the chain, mention Vin only when the `vin` row of `cycle_seasonality(month=<M>)` in Bước 3 reaches the threshold in `references/seasonality-vn.md` §1 **or** the `vin` column of `cycle_trough_events` in Bước 1 qualifies (see `references/market-history.md` §2). NEVER pick specific stocks, NEVER give buy/sell rules (that is another skill's job).

## Cấu trúc câu trả lời

In exactly this order: table freshness (`as_of` from the check) · phase verdict (1 line + confidence) · evidence from the 4 pillars (each number with tool provenance) · 1–2 suggested groups with live hit rates · the most similar historical phase · definition changes in this refresh (if any, quoting the changelog) · caveats + a refresh suggestion if the tables are old. About 14–18 calls, batched in parallel within each step.

## Ngôn ngữ trình bày

The abbreviations in `references/` are for your work, not for writing to the user:

| Internal notation | Write for the user |
| --- | --- |
| RS 3M, RS 1M, RS mảng | sức mạnh tương đối 3 tháng/1 tháng của nhóm ngành so với VN-Index (the first time, explain what "sức mạnh tương đối" means) |
| VNI, VNFIN, CK, BĐS, utilities, consumer | VN-Index, VN-Finindex, chứng khoán, bất động sản, tiện ích, tiêu dùng |
| vin, mảng Vin | nhóm cổ phiếu Vin (VIC, VHM, VRE, VPL) |
| drawdown, bear, bull | mức sụt giảm sâu nhất, pha suy yếu, pha phục hồi |
| bias tháng, hit-rate, breadth | xu hướng thường thấy của tháng đó, tỷ lệ đúng theo lịch sử, độ rộng thị trường |
| pre-Tết, post-Tết, turning | trước Tết, sau Tết, đảo chiều |

Keep index names and tickers as they are (VN-Index, VN30). The rules and thresholds in `references/` are for deciding, not for copying out to the user; every figure, ranking and rate comes from tools. State the phase in your own words, with confidence and sources.

## Ví dụ

**Ví dụ 1:**
Hỏi: Thị trường đang ở giai đoạn nào, sóng ngành nào tiếp theo?
Đạt khi: table freshness (`as_of`), a phase conclusion with confidence, the 4 pillars with numbers + source tools, 1–2 suggested groups with hit rates from `cycle_chains`, and the small-sample caveat.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type.

## File tham khảo

| File | Answers |
|---|---|
| `references/seasonality-vn.md` | How to read the seasonality table + interpretation thresholds + the Tết mechanism (numbers from tools) |
| `references/rotation-chains.md` | Chain definitions + RS reading rules + peak timing rules |
| `references/phase-playbook.md` | The 4 phase definitions + the phase→group matrix + the phase scoring checklist |
| `references/market-history.md` | Vietnam's cycle timeline since 2011 (narrative; numbers from tools) |
| `references/refresh.md` | When + how to refresh via MCP tools + changelog |
