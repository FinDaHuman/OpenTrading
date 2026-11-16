# Time-series: nến, line, area, sparkline

The TradingView standard (lightweight-charts default scaleMargins): price padding
top 20% / bottom 10% — lines/candles never touch the border.

## Candlestick + volume

- Input: `bars: [{o, h, l, c, v?}]` (≥5 candles) + `times` (dates, e.g. 09-01).
- With `v` → a 4-line volume pane under the price, in the same columns as the candles, coloured by candle direction
  (green up / red down), the title showing total Vol.
- Compact adjoining candles: each candle 2 columns (body + gap).
- The X axis matches the candle columns: the first date under the first candle, the last date under the last.
  Dates too long/crowded → rotated vertically (one character per line at the candle column).

## Trục X (mọi chart time-series)

- A horizontal `└───` line + a `●` dot at the exact column of each time point.
- Date labels: first on the left — last on the right (rotated vertically if long/crowded).
- `┤` fixed at column 7, a fixed plot width → the X axes of several charts line up for comparison.

## Line / area / sparkline

- Input: `series` (≥2 points) + `times` for the X axis + `unit` (e.g. kVND, shown as `[unit]` in the title).
- A smooth braille line, coloured by trend (up green / down red).
- Area = a line of rounded box characters (╭╮╰╯) + a faint fill under the line (empty columns interpolated).
- Sparkline = a mini braille line 4 lines tall (not a block strip).
- Sparkcolumn = columns 6 lines tall; `dirs` (each column's price direction) colours them green/red
  by price — volume is always positive, so colouring by sign would make everything green.
