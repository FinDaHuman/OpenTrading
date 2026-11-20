# So sánh: bar, boxplot, histogram, compare, winloss

## Bar diverging

- Input: `series` + `labels`. Negative LEFT, positive RIGHT.
- A SHARED zero: the `│` bar sits in the same column on every row (bars cap themselves to leave room for numbers).
- Each number sits right next to its bar: negative `-8 █████` on the left, positive `█████ 25` on the right.
- A black border around the block + `├─┤` separators between bars.
- Long labels wrap onto several lines (full names); every block has the same height, content centred.

## Boxplot (chuẩn)

- Input: `matrix` — each row 1 GROUP of the SAME magnitude (e.g. % returns of tickers).
  Different magnitudes → flattened boxes, unreadable.
- Each group ≥4 points. The box is 3 lines tall: whiskers only on the middle line, `│` caps at both whisker ends,
  the `█` Q1–Q3 box filling all 3 lines, the median a vertical `┃` through the box + the legend
  `┃ median (trung vị)`.
- The middle line shows min ─ Q1 ─ median ─ Q3 ─ max.

## Histogram

- Input: `series` (≥5 points). Automatic Sturges bins (4–12) — few empty bins.
- A black border + separators between bins. Each bin shows its range + count.

## Winloss

- Input: `series` of per-session values (≥2) — the sign = win/loss, the number = magnitude.
- One line per session: `Phiên 1 ▲ thắng +4.5` / `▼ thua -2.4` (numbers always signed).
- Plain text also shows the numbers (to read the verdict), not just ▲▼.

## Compare % (chart_render kind=compare)

- Input: `from_calls` (filter with `symbols`), or hand-typed `labels` + `matrix` (2–5 rows; lengths may differ, aligned at the last point).
- Each ticker is 9 braille lines tall + ITS OWN Y AXIS (each chart's scale labels) + a header
  `● tên +cuối%` + a blank line between tickers.
- `times` for the X axis;
  the % scale is printed in the title, `unit` shows `[%]`.
