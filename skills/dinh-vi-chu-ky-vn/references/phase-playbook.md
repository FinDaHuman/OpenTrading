# Playbook 4 pha + ma trận pha→mảng (số tra tool, file giữ logic)

> The suggestions here are GROUPS (with hit rates looked up from `cycle_chains`): no stock picking, no buy/sell rules.

## 1. Định nghĩa 4 pha

| Phase | Name | Sufficient signs (≥3/5 needed) |
|---|---|---|
| **P1** | Early recovery / start of year | (a) VNI just made a major trough (drawdown >15% then rebound >20%) or it is T12–T2 · (b) bank 3M RS positive, securities turning positive · (c) SBV cutting/holding the policy rate low · (d) bank monthly bias in T1/T12 outperforming (look up `cycle_seasonality`) · (e) pre-Tết bank/retail strong (look up `cycle_tet`) |
| **P2** | Mid-wave | (a) securities/steel 3M RS strongly positive · (b) VNFIN not yet peaked (peak < 3 months ago, look up `cycle_turning`) · (c) breadth > 50% · (d) monthly bias: securities T8/T11, steel T2, oil & gas T5 · (e) post-Tết steel/chemicals/transport strong |
| **P3** | End of wave / distribution | (a) VNFIN peaked > 3 months ago while VNI still rises · (b) real estate/utilities 3M RS positive while bank/securities are already negative · (c) any group's 3M RS > +15% (overheated) · (d) T10 monthly bias weak across the board · (e) SBV tightening/holding high + bill absorption |
| **P4** | Downturn / bear | (a) VNI drawdown > 20% from the peak · (b) every group's 3M RS deeply negative · (c) consumer/utilities fall least · (d) steel/securities/real estate fall most |

## 2. Ma trận pha → mảng gợi ý (hit-rate tra `cycle_chains` mỗi lần dùng)

| Current phase | Next suggested groups | Basis |
|---|---|---|
| P1 (bank 3M RS positive) | The chains bank→steel · bank→securities · bank→real estate | Order by `rel_mean` when you look up `cycle_chains`; the order written here is not a priority |
| P1 after Tết | Steel · Chemicals · Transport · Oil & gas | `cycle_tet` post (hit rates from the tool) |
| P2 (strong securities) | The chains securities→IT · securities→real estate | Order by `rel_mean` when you look up `cycle_chains` |
| P2 (strong real estate — reverse chain) | The chain real estate→securities | Only when `rel_mean` is positive at the `cycle_chains` lookup |
| P2 in month 8 / month 11 | Securities (+ other groups with a bias per `cycle_seasonality(month=8)` / `(month=11)`) | T8/T11 bias outperforming (thresholds in seasonality-vn §1) |
| P3 | Gradually reduce real estate/utilities "last leg"; AVOID chasing when VNFIN peaked > 3 months ago | The timing rules in rotation-chains section 4 |
| P4 (falling) | Shelter: consumer + utilities · AVOID: steel/securities/real estate | Look up `cycle_yearly` for the latest bear year (absolute annual return, not RS) |
| P4 (just bottomed) | Technical rebound: groups ranked in the top 3 at every past trough | Look up `cycle_trough_events` (state the number of troughs from the tool result; with fewer than 3 troughs only state an observation, settle nothing — see `market-history.md` §2) |

- **Vin**: the condition for using Vin in a chain is in `rotation-chains.md` §1 (one single rule — never derive other thresholds). Outside the chain, Vin is only separate information: the monthly bias of the `vin` row (`cycle_seasonality`, thresholds in `seasonality-vn.md` §1), the `vin` column of `cycle_trough_events` (reading rules in `market-history.md` §2), group events.

## 3. Checklist chấm pha (dùng ở Bước 5 của SKILL.md)

Score each pillar +1/0/-1 (supports/neutral/against), then add up:
- 3M RS: bank + securities positive (+1 P1/P2) · real estate/utilities positive on their own (+1 P3) · all deeply negative (+1 P4)
- Peak timing: VNFIN peak < 3 months ago (+1 P2) · VNFIN peak > 3 months ago while VNI rises (+1 P3)
- Seasonality: which groups the current month favours (look up `cycle_seasonality`) — if they match the groups currently on top, +1 to the matching phase
- Monetary: SBV easing (+1 P1/P2) · tightening (+1 P3/P4)
- Total ≥ +3 for one phase with no contradicting -1 pillar → that phase's verdict, high confidence; +2 → medium confidence; otherwise → "chưa rõ pha" + state 2 scenarios.

## 4. Ranh giới (không vượt qua)

- Suggest only GROUPS + hit rates from tools. Specific stock picking → the ticker analysis skills. Buy/sell rules, sizing, stop losses → the strategy/backtest skill.
- Sector analysis by its own drivers/KPIs/valuation (e.g. "NIM ngân hàng đang thế nào", "thép chịu gì từ giá than") → the 13 sector skills, table in SKILL.md section "Bản đồ skill ngành". This skill does not read sector KPIs; sector skills do not determine the phase.
- Pairs with a negative `rel_mean` at lookup (e.g. bank→oil & gas, strong bank→consumer, strong IT→securities) — not signals; recheck with `cycle_chains` each time. Oil & gas follows only oil prices + seasonality.
- Defensives (consumer/staples) in Vietnam almost never lead a wave — suggest them only as SHELTER in P4 (and in weak months when `cycle_seasonality` shows consumer falling less than VNI), never to catch a wave.
- food/insurance/construction: at the time of writing they have no reliable chain link (recheck `cycle_chains`) — read them only by seasonality/Tết; never suggest them as "leading".
- Vin: never suggest Vin as the "next leading" group unless the **Vin condition** in `rotation-chains.md` §1 is met. Outside the chain, Vin is only information (seasonality / troughs / group events), not a suggested group.
- NEVER invent new thresholds: every checklist threshold (RS +15%, drawdown 20%, breadth 50%...) changes only with quantitative evidence from ≥2 cycles in new data.
- NEVER copy table results into `references/`: measured results go stale after each refresh and the model would quote the file instead of looking up the tool. If new numbers contradict a rule, rewrite the **rule** as a condition that can be looked up; never copy the table (the rule is in `docs/contracts.md` §3).

## 5. Giới hạn của bảng chu kỳ (đọc kèm mọi kết luận)

- Short samples: each chain pair and each seasonality cell covers only a few dozen months / a few years. Always state `n_up` or `n` with the conclusion; with small samples, lower confidence.
- Picking the max over many cells is the maximum of noise: a group that "stands out" in one cell may be luck, not a trait — never raise it into a rule.
- Years/months whose data is not closed: partial columns and YTD years are not final results.
- Fewer than 3 troughs: state only an observation; do not settle the leaders.
