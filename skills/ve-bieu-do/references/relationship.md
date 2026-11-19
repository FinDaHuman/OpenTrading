# Tương quan: scatter, multiline chỉ số, heatmap

## Scatter phân nhóm

- Input: `points` (x, y, ≥3 points) + `groups` (each point's group) + `labels` (group names).
- Braille cells cannot enlarge dots → distinguish by COLOUR + legend
  (each group 1 colour, the legend counts points: `● VCB (7 điểm)`).
- A SHARED X+Y domain across all groups (computed automatically, no overlay drift).
- The X axis shows the x range (e.g. volume 5.0M … 14.0M).

## Multiline CHỈ SỐ (không phải giá)

- Input: `matrix` (each row 1 series) + `labels` + `times`.
- Only for indicators in the SAME unit (RSI, Stochastic, PE, PB...).
- NEVER draw the prices of several tickers (different magnitudes → flattened) — for several tickers' prices use `chart_render kind=compare`.
- Each series 1 colour + a legend with the last value. Padding top 20% / bottom 10%.

## Heatmap gradient

- Input: a 2D `matrix` + labels (rows, then columns).
- A gradient background green (low) → red (high) via `mix()`, cell text in contrast
  (light on dark backgrounds). Full row + column headers.
