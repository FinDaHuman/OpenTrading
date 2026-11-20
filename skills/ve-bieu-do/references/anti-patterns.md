# Anti-patterns — những gì KHÔNG được vẽ

- Never draw without the minimum points (candles <5, line <2, boxplot groups <4, pie all ≤0...).
- Never multiline the prices of several tickers (different magnitudes → flattened) — use `chart_render kind=compare`.
- Never a pie with >7 slices (read a legend bar instead).
- Never a 2-slice pie / a donut for a distribution — a donut is only for 1 value/max.
- Never a boxplot of groups with different magnitudes.
- Never a scatter without groups when there are ≥2 tickers (braille dots of the same size, no colour = indistinguishable).
- Never a gauge without max; never a heatmap with an empty matrix.
- Never pick colours yourself — rising green, falling red (the Vietnamese price board).
- Never map by tool name — the same tool can produce several shapes (`money_flow` has both
  a sign → winloss and BuyVal−SellVal → waterfall); always look at the data SHAPE.
- Never copy the picture into the answer — the colour chart shows in the TUI by itself; give only a 2–3 sentence verdict.
