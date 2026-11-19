# Tự cập nhật bảng thống kê (refresh procedure — PG-backed)

> Purpose: keep the prior tables in PG (`cycle_*`) from getting too old.
> Principle: **suggest when stale** — the skill checks staleness on each call (Bước 0), and a refresh runs only if the user agrees. A refresh uses WRITE tools on the server (long-running, each asks for approval): find them with `tool_search` when needed; the skill does not preload them.

## 1. Khi nào refresh (điều kiện kích hoạt)

Refresh when ONE of these holds:
- (a) `cycle_stats_check` reports `days_stale` over **90 days**.
- (b) **Lunar New Year (Tết)** just passed and the Tết table does not include it yet.
- (c) A **major cycle trough/peak** just happened (drawdown > 20% or a new all-time high).
- (d) The user asks explicitly.

When triggered but the user has NOT agreed: only warn + cap the verdict's confidence at "trung bình"; never run it on your own.

## 2. Kiến trúc dữ liệu

| Layer | Content | How it is refreshed |
|---|---|---|
| **Live** (not stored) | Group 3M RS, the latest peak, the current month's bias | Computed directly from MCP tools on each call (`vn_index_ohlcv` 64 candles, `seasonality`, `event_study`) |
| **Long-run prior** (PG `cycle_*`) | month_stats, chains, turning, tet, yearly, trough_events | The `cycle_stats_*` tools below; version in `cycle_meta` |

## 3. Quy trình refresh bằng MCP tools (mặc định, incremental)

1. `cycle_stats_check()` → confirm staleness + coverage. If it warns "cấu hình cũ (members_version=...)" → the tables were computed from an older sector list and must be refreshed + finalised before concluding.
2. `cycle_stats_refresh(symbols=[...12 tickers...])`, repeated until the **server-managed watch list** is covered (the members of the current configuration version) — take the list from the server; never count by hand or infer the ticker count from this file. A batch that `failed` → call that batch again (resumable). The first run is full from 2018 (VNINDEX from 2011); later runs fetch only the delta. Overlap-validate 10 sessions; a gap >0.5% → the tool re-fetches that ticker in full. The `cached_symbols` that `cycle_stats_check` reports is the number of tickers **already in the cache**, not the number to refresh — with an empty cache you must still refresh **the whole** list.
3. `cycle_stats_finalize(extra_tet=[...])` (with the new Tết if any) → recompute everything + bump `cycle_meta`.
4. Compare the results with the previous run: any cell changing > 20% → mention "đảo regime" in the answer.

Computation conventions (locked): equal-weight basket = mean of daily returns (daily-rebalanced), **NEVER the median**; coverage floor 2018-10-01; resample `prod(min_count=1)`; hit rate counted only over months with data; members v2 (15 groups) versioned in the tool; the `basket` parameter accepts Vietnamese names without diacritics.

## 4. Fallback khi MCP tools không sẵn sàng

Use `vn_index_ohlcv` + `seasonality` + `event_study` for the latest peak/trough and bias; state "số PG chưa refresh" in the answer.

## 5. Sau refresh

- Tell the user: which tables changed, which numbers changed materially (>20%), the new `as_of` (from `cycle_stats_check`).
- Return to the normal skill workflow with the new tables.

## 6. Không sửa file skill

The skill keeps only the method; every number is always looked up at the time of use. After a refresh, do **not** edit SKILL.md or `references/` (the harness has no tool that writes skill files, and skill files hold no market data — `docs/contracts.md`). If new numbers contradict a rule in `references/`, say so clearly in the answer so the maintainers update it.

## Changelog

- [2026-10-09] stats v1→v2 (PG initialised from the cache, as_of 2026-10-09): seeded 180,621 rows/90 tickers; definitions: references moved to methodology-only (number tables removed, logic kept), the SKILL.md workflow moved to MCP tools; removed the cycle_stats_* harness (TS+py+cache JSON). Reviewed under the section 6 process.
- [2026-10-11] Removed the self-editing of skill files; the refresh tools are no longer preloaded; stop when the tables have no data.
- [2026-10-18] members v1→v2 (as_of 2026-10-18, full rebuild): the sector list became 15 groups/119 tickers — **Vin** (VIC/VHM/VRE/VPL) split from real estate; telecoms merged into IT; dead tickers ITA/POM/SFN removed; 43 tickers added to thin groups (insurance/construction/steel/chemicals/power/food/transport...). Server additions: Vietnamese name aliases for `basket`, the old-`members_version` warning in `cycle_stats_check`, 3 Vin chain pairs, a `vin` column in `cycle_trough_events`. The new numbers contradicted some old rules (see `rotation-chains.md` sections 1/4, `market-history.md` section 2) — references updated to the v2 tables.
- [2026-10-20] Merged the Vin usage rules into **one single rule** in `rotation-chains.md` §1: `rel_mean` > 0 · `rel_hit` ≥ 60% (the "moderate" level already in `seasonality-vn.md` §1) · `n_up` large enough to trust · the chain's starting condition currently holds; at most 1 of the 2 suggested groups. `SKILL.md` Bước 5 and `phase-playbook.md` §2/§4 point there instead of setting their own thresholds (before, 3 files used 3 different thresholds). Dropped "Vin strong in T3/T4/T11" — Vin's months are read in the `vin` row of `cycle_seasonality`.
- [2026-10-20] Returned references to methodology-only (the rule is in `docs/contracts.md` §3): removed the **table results** copied in on 2026-10-18 — chain order by `rel_mean`, the winners of each year and each trough, years + peak lags (2021/2025/2026), the T8/T10 group lists, each group's own strong months, sample counts and the "basket v2" header; replaced them with how to look up the tool + the existing thresholds. Also fixed: `cycle_yearly` is **absolute** annual return (not RS), `cycle_turning` skips the current year (YTD peak), `cycle_stats_refresh` takes the ticker list from the server (not using `cached_symbols` as the count to refresh), and added the "Giới hạn của bảng chu kỳ" section. Qualitative rules marked "kiểm lại" kept as they were.
