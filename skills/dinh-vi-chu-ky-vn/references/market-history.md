# Lịch sử chu kỳ VN 2011→ (đối chiếu pha — narrative giữ, số tra tool)

> The timeline and causes are background knowledge (kept in this file). Every return/peak/trough figure is looked up with tools (`cycle_turning`, `cycle_trough_events`, `cycle_yearly`).

## 1. Timeline – nguyên nhân (mức đỉnh/đáy: tra `cycle_turning(year=...)`)

| Period | What happened | Main causes |
|---|---|---|
| 2012 | Trough early in the year, rebound late | Bad debt, 2011 tightening; credit recovery |
| 2014 | Mid-year crash, then rebound | The East Sea incident |
| 2016–2017 | Long uptrend | High credit, bank + Vingroup in the lead |
| 2018 | April peak, deep correction | Fed tightening, the US–China trade war |
| 2019 | Sideways | VIC/VHM + VCB in the lead |
| 2020 | COVID trough in March, strong rebound late in the year | SBV cut the policy rate 3 times; cheap money + margin |
| 2021 | Mega-cycle, peak at year end | Rock-bottom rates, new investors + margin; securities→bank→real estate→steel→oil & gas |
| 2022 | Peak early in the year, panic trough at year end | Van Thinh Phat/SCB, corporate bonds, Fed hikes |
| 2023 | Rebound | SBV cut rates several times; securities/growth rebound |
| 2024 | Wide sideways range | Credit growth; IT breakout |
| 2025 | April tariff shock, then a strong uptrend | Expectations of the FTSE upgrade, high credit |
| 2026 | Profit-taking after the upgrade | High Brent; the year is not over — look up `cycle_yearly(year=2026)` and state "tính đến `as_of`" |

The table above is qualitative notes, not verified with tools. To state any year's index level, date or %, look up `cycle_turning` / `cycle_yearly` first.

> `cycle_yearly` ranks by **absolute annual return**, not RS (RS = return in excess of VNI). For "RS leaders", subtract the VN-Index return for the same year yourself and state the method.

## 2. Ai dẫn sau các đáy lớn (tra `cycle_trough_events`)

How to read it:
- Few troughs have complete data (coverage since 2018-10) — **state the number of troughs from the tool result** and treat it as a small sample.
- Only groups ranked **in the top 3 at every trough** count as post-trough leaders. Rank them by reading the 3-month post-trough returns the tool returns directly, sorted high to low (the tool has no rank column).
- "Rank differs clearly" = in the top 3 at one trough but outside the top 5 at another → that group is not used as trough-buying experience.
- Read the `vin` column like any other: if its rank differs across troughs, do not use it.
- **Fewer than 3 troughs: state it only as an observation; do not settle the leaders.**
- Never quote ranks from this file.

## 3. Quán quân theo năm (tra `cycle_yearly`)

How to read it: rank groups by annual return, then match the **year type** in the section 1 table (mega-cycle, bear, rebound, a year with its own wave) to find the most similar historical phase. The year type is only a timeline label — **never** infer the leading group from it; the leading group must be looked up in `cycle_yearly` each time. For an unfinished year, state "tính đến `as_of`" (`as_of` comes from `cycle_stats_check`).
