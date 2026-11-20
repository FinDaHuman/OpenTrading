# Tỷ trọng: pie, donut, stacked, waterfall

## Pie THANH TỶ LỆ 100%

- Input: `series` + `labels` (≥2 slices, at least 1 slice >0; slices ≤0 are dropped).
- One full-width horizontal bar split into segments by % (the smallest slice ≥1 character,
  the remainder going to the largest slice), each slice 1 colour + a legend (colour box + name + %).
- The slices must total ≈100%.

## Donut THANH TỶ LỆ (giống pie)

- Input: `value` + `max` (1 single number).
- A horizontal bar with 2 segments: the achieved part green + the remainder grey + a legend
  (name + %). A blank line separates the bar from the legend.

## Stacked

- Input: `matrix` (each row 1 group) + labels (group rows, then component columns).
- Each component 1 colour + a legend below. Each row is 100% of that group.

## Waterfall

- Input: `start` + `series` deltas (≥1 step) + `labels` for each step.
- Each step is 1 bar from the old total → the new total (├█┤ green up / ├░┤ red down),
  showing the delta and the running total. A blank line between steps.
- The first row `Bắt đầu │` and the last `Kết thúc │`.
