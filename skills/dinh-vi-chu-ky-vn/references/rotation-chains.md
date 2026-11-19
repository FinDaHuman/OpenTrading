# Chuỗi luân chuyển định lượng (đọc qua tool, không hardcode số)

> The figures live in PG (`cycle_chains`, `cycle_turning`, `cycle_trough_events`, `cycle_yearly`) and are looked up with the matching tools. This file keeps the chain DEFINITIONS + timing rules + how to read RS.

## 1. Chuỗi relative: A mạnh → B vượt VNI tháng sau?

- Definition: RS = return in excess of VNI; a signal when 1M/3M RS > +2%; read the full `cycle_chains()` table (columns `rel_mean`, `rel_hit`, `n_up`) or `(pair="bankRS3m->securities")`.
- **Priority between pairs: take it from `rel_mean` when you look up `cycle_chains`**, never from a remembered order. Read each pair with `rel_hit` and `n_up`.
- The reverse direction also matters (securities→bank, steel→securities, chemicals→bank): Vietnamese waves often run both ways bank↔securities↔real estate.
- A pair with a negative `rel_mean` at the latest lookup (e.g. bank→oil & gas, strong bank→consumer, strong IT→securities) → not a signal; recheck with `cycle_chains` each time. Oil & gas follows only oil prices + seasonality, not the bank→real estate→oil & gas flow.
- **Vin in the chain.** 3 pairs involve Vin in `cycle_chains` (bank→Vin, Vin→real estate, real estate→Vin — find them in the full table). A Vin pair is usable only when **all 4 conditions** hold: `rel_mean` > 0 · `rel_hit` ≥ 60% (the "moderate" level in `seasonality-vn.md` §1) · `n_up` large enough to trust (state `n_up`; small → lower confidence) · the chain's starting condition currently holds (e.g. positive bank 3M RS). At most 1 of the 2 suggested groups. Vin moves on its own rhythm (large market cap, the group's own story) → always check group events before mentioning it.
- Small samples: each pair has only a few dozen months (since 2018-10); always read it with `n_up` and treat it only as a hint, not a law.

## 2. Lead-lag

- No tool returns weekly lead-lag: never use claims like "securities this week → real estate/VNI next week" as evidence.
- Monthly lead-lag is mostly slightly negative (mean reversion): do not chase a linear lead at the monthly horizon; use only the relative chains of section 1.

## 3. Đọc RS 3M (giá đầu/cuối 63 phiên từ `vn_index_ohlcv` 64 nến (nến đầu = 63 phiên trước), `market_candles_batch` cho Vin; tính bằng `shell`)

- 3M RS > +15% after a bank-led stretch = overheated, usually 1–3 months before a peak.
- Positive bank + securities RS with negative real-estate RS = the start/middle of a wave (money has not reached real estate yet).
- Real estate/utilities RS positive on their own while bank/securities are already negative = the "last leg" at the end of a wave.
- Every group's RS deeply negative (< −20%) = bear or pre-trough; for the rebound after it, favour groups ranked in the top 3 at every past trough — look up `cycle_trough_events` (reading rules in `market-history.md` §2).
- Vin has no index of its own: 3M RS is computed from the average % change of VIC/VHM/VRE/VPL (state the method); Vin can surge/rest completely apart from the rest of the market.

## 4. Quy tắc timing đỉnh (verify bằng `cycle_turning(year=...)`)

1. **VNFIN peaking 3–6 months before VNI = a sign of the end of a wave.** Before using it: look up `cycle_turning` for the latest 2–3 **completed** years — **skip the current year** (the function returns the YTD peak for the current year, not a confirmed peak); pick years where VNI rose strongly (cross-check `cycle_yearly`) and compute the VNFIN→VNI lag for each year (record the peak dates). If the lags fall within 3–6 months at recent peaks, apply the rule; if the lags differ across years (including years where VNFIN peaked after VNI), lower confidence and do not extrapolate.
2. **VNREAL/VNUTI stretching 1–4 months after the VNI peak = the "last leg"** → exit gradually; do not chase real estate/utilities at this point.
3. Panic troughs: the indices usually bottom at about the same time (the late-2022 pattern — check with `cycle_turning`/`cycle_trough_events`), but real estate often bottoms later and rebounds weakest after the trough; check Vin separately in the `vin` column of `cycle_trough_events` (if its rank differs clearly across troughs, do not extrapolate — see `market-history.md` §2).
4. A known exception: when VNI peaks early because the Vin pillars (VIC/VHM) pull it while VNFIN stretches further (the 2024 pattern) → always check breadth (`breadth_scan`) alongside.
