# Mùa vụ thị trường Việt Nam (đọc qua tool, không hardcode số)

> The figures live in PG (`cycle_month_stats`, `cycle_tet`) and are looked up with `cycle_seasonality` / `cycle_tet`. This file keeps only HOW TO READ + interpretation thresholds; never quote any number from this file as data.
> Sample size: read the `n` column of each cell. Group rows have shorter samples than the VNINDEX row — compare within the same row; never compare n.

## 1. Đọc bảng mùa vụ (`cycle_seasonality`)

- No parameters = the full table (basket × months 1–12): `mean_ret` (average %/month), `hit_rate` (% of positive months), `rel_ret` (excess over VNI), `n` (sample).
- Filter: `cycle_seasonality(basket="bank")` or `(month=1)`; Vietnamese names without diacritics are accepted too ("bất động sản", "dầu khí", "vin").
- Interpretation thresholds: hit ≥ 75% = strong bias; 60–75% = moderate; < 50% = no bias. Only |rel| ≥ 2%/month is material.
- An unfinished month column (partial) settles after the month ends — never conclude firmly on a partial cell.

## 2. Cấu trúc mùa vụ VN đã biết (verify lại bằng tool mỗi lần dùng)

The lines below are **hypotheses (priors) to steer the tool lookups**, not signals. A signal = a cell meeting the §1 thresholds (hit ≥ 60–75% and |rel_ret| ≥ 2%/month) **and** with `n` large enough to trust; otherwise conclude nothing. (T1–T12 = months 1–12.)

- Q1 (especially T1–T2) is usually the best of the year; T12→T3 is a good window.
- T4 has the lowest hit ("selling ahead of Sell-in-May"); Sell-in-May does NOT hold in Vietnam (T5 is usually positive).
- T8 is usually the second best and broad — for which groups outperform, look up `cycle_seasonality(month=8)`; never take a list from this file.
- T10 is the worst for almost every group (NAV/Q3 closing + reporting season) — for groups that fall least or keep a positive `rel_ret`, look up `cycle_seasonality(month=10)`.
- Bank = a start-of-year group (T1/T12 outperform); securities strong in T8/T11, weak in T10; steel strong in T2 (after Tết); oil & gas strong in T1–T2/T5, weak in T3–T4.
- Vin: read its seasonality in the `vin` row of `cycle_seasonality(month=<M>)` — no fixed months are written in this file; the condition for using Vin is in `rotation-chains.md` §1.
- Consumer staples have almost NO outperforming seasonality — they only "fall less" (especially T10); use them as shelter.

## 3. Hiệu ứng Tết (`cycle_tet`)

- Definition: pre ≈ the sessions just before Tết, post ≈ the first 5 sessions after Tết — the exact session count comes from the `cycle_tet` result; record it when quoting.
- Mechanism: pre-Tết bank/retail/transport are strong (cash flow + expectations of new-year credit room); post-Tết rotates to steel–chemicals–transport–oil & gas (manufacturing and construction restart); steel has NO pre-effect (low hit; numbers from the tool).
- Look up `cycle_tet()` for the full table or `(basket="steel")`. `cycle_tet` returns no `n` column — count the Tết occurrences in the sample when quoting; the Tết sample is shorter than the monthly one, so always state the sample with the conclusion.
- A new Tết: pass it to `cycle_stats_finalize(extra_tet=[...])` at the first refresh after Tết.
