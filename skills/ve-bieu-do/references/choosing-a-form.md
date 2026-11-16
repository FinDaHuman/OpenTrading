# Cây quyết định chọn hình theo shape data

Go down from Q0. Each node is 1 yes/no question about the data SHAPE (never about the
tool name — whatever shape a future tool returns falls into the right branch).
**STOP at the first matching ★ node**: take its list of candidates → pick 1 by the
context of the user's question (selection hints are written under each ★ node).
No branch matches → Q8. Below a minimum threshold → report the missing data;
NEVER draw an empty chart, NEVER invent numbers.

Q0. Has the user said clearly which chart they want (candles/line/pie...)?
    YES → skip the tree, draw it directly.  |  NO → Q1.

Q1. Does the data have CUMULATIVE ordered deltas? (step before → step after,
    with a running total: net money flow per session, step-by-step P&L, base → shocked)
    YES → ★ [waterfall]  (needs start + ≥1 delta; each step shows the delta + running total)
    NO → Q2.

Q2. Does the data have a continuous TIME column? (date/datetime/ordered sessions. Discrete
year labels — e.g. dividends 2022/2023/2024 — count as CATEGORY, not time.)
├─ YES → Q3 (the TIME branch)
└─ NO → Q4 (the NON-TIME branch)

── NHÁNH TIME ──
Q3. Does each point have full O/H/L/C?
├─ YES → ★ [candlestick]  (+a volume pane if there is a v column; times → X axis; needs ≥5 candles)
└─ NO (single values only) → Q3b. How many number series?
    ├─ 1 series → ★ [line, area, sparkline, sparkcolumn, linebox, winloss]
    │    line: a detailed trend (default)  |  area: stresses the accumulated block under the line
    │    sparkline: compact/quick, short series ≤6 points  |  sparkcolumn: ordered columns
    │    + dirs (e.g. per-session volume)  |  linebox: box-character style
    │    winloss: only when the SIGN of each session is the message (win/loss), not
    │    the value trend (±% returns per session are still a line).
    │    (Common threshold: ≥2 points/sessions.)
    ├─ ≥2 series in the SAME unit (RSI/PE/PB/%, returns, yields)? → ★ [multiline]
    │    Each series 1 colour + a legend. Each series ≥2 points, ≥2 series needed.
    │    (Several tickers' prices share a money unit but differ in magnitude → NOT here.)
    └─ ≥2 series of DIFFERENT magnitude (several tickers' prices, ticker vs index)? → ★ [chart_render kind=compare]
         Normalised to % from the first point, each ticker 9 lines + its own Y axis.
         2–5 series, each ≥2 points.

── NHÁNH KHÔNG-TIME ──
Q4. Does the data have GROUP/category labels? (tickers, sectors, events, months, outcomes...)
├─ YES → Q5.
└─ NO (plain numbers / a special structure) → Q6.

Q5. What kind of number does each group have?
├─ 1 value/group, with BOTH NEGATIVE and POSITIVE? → ★ [bar diverging]
│    (negative left, positive right, a shared zero. E.g.: % up/down, net money flow,
│    premium/discount, ± odds, price changes.)
├─ 1 value/group, NOT negative:
│   ├─ The groups total ≈100% AND ≤7 groups? → ★ [pie, bar]
│   │    pie: shares at a glance (a 100% bar + legend);
│   │    bar: when each % must be compared precisely.  (E.g.: holders, weights, 4-group breadth,
│   │    buy/hold/sell rating mix. A pie needs ≥2 slices, at least 1 slice >0.)
│   ├─ Totals ≈100% but >7 groups? → [bar].  (A pie with >7 slices is unreadable.)
│   └─ Everything else (revenue, targets, odds %, counts, a price snapshot of several tickers,
│       1 metric of a peer table)? → [bar].  (A single group can still be a 1-column bar.)
├─ Group × COMPONENTS (each group split into several parts)? → ★ [stacked]
│    Each component 1 colour + a legend. E.g.: buy/sell per session, revenue/profit by quarter.
└─ Per-session win/loss + magnitude (the ± sign is the point)? → ★ [winloss]
     One line per session ▲+number / ▼−number. Needs ≥2 sessions.

Q6. Is the data a DISTRIBUTION (many measurements of the same phenomenon)?
├─ 1 group of many values → ★ [histogram]
│    Automatic bins. Needs ≥5 points. E.g.: CARs of events, correlations of windows,
│    returns of 1 ticker.
├─ Several groups of the SAME magnitude → ★ [boxplot]
│    Each group ≥4 points. E.g.: % returns of several tickers, CAR by event group.
│    (Different magnitudes → flattened boxes: normalise to % first, or switch to bar.)
└─ Not a distribution → Q7.

Q7. Which special structure?
├─ 2 numeric variables (x, y) per observation? → ★ [scatter] (+groups per ticker + legend)
│    E.g.: volume↔price. Threshold ≥3 points. Same-size braille → distinguish by COLOUR.
├─ A real 2D matrix (rows×columns both labelled)? → ★ [heatmap]
│    E.g.: a correlation matrix, a fast×slow param grid, month×metric.
│    (A plain single row + single column → back to Q5 bar.)
├─ A bid/ask ladder (price+volume buy/sell)? → ★ [chart_render kind=depth]
│    ASK red / BID green. An empty book on both sides (off-hours) → report it honestly.
├─ 1 number + max (an index, a score /100, % complete)? → ★ [gauge, donut]
│    gauge: an index/threshold (fear, an RSI snapshot...);
│    donut: 1 part of a total (a 2-segment bar). Needs value + max.
│    (A score on another scale — e.g. sentiment −1..1 — normalise to max first.)
├─ A dict of many indicators in DIFFERENT units that cannot be drawn together? → text + optionally
│    a separate gauge for a single indicator with a max (e.g. RSI in a signals snapshot).
│    (E.g.: signals_technical, vs_trading_info, stock_overview.)
├─ A peer table (rows × metrics)? → pick 1 metric → back to Q5 [bar].
│    (E.g.: peer_compare, compare_equities, financial_ratios.)
└─ 1 single value, no trend, no max? → [DO NOT DRAW — write the number + text]
     E.g.: the latest price, an index value.
     (Date calendars WITHOUT values — event_calendar, corporate_calendar... —
     always text; never force them into a branch.)

Q8. [Catches every remaining case — future tools] No branch matches?
→ Do not guess: compare with the nearest node in priority order
   (has time → the TIME branch; has labels → Q5; a matrix → heatmap; odds/prob → Q5 bar),
   or DO NOT DRAW and report the shape you saw (column types + an example of the first 2–3 rows)
   so the tree can be extended later. Never invent data to fit a chart.
