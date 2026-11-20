# Đọc corr regimes (tra `g_asset_corr`)

- `regime="full"` (2010→): the long-run baseline. `pre22` vs `post22`: the 2022 structural break.
- Verified points: SPY–TLT flipped negative→positive after 2022 (bonds lost their hedge role); BTC–SPY rose (ETF-ization); DBC–SPY dropped (commodities idiosyncratic); the GLD–UUP seesaw strengthened.
- The recent spike in BTC–gold correlation is a feature of the period, not its nature (low long-run; gold is the better safe haven, BTC only diversifies) — read the numbers by regime in `g_asset_corr`.
- Rule: every correlation conclusion must state the regime; when the average full-sample correlation hides a break, say so.
