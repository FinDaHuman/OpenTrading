---
name: ve-bieu-do
description: "Draws colour charts in the terminal from tool data you already have (candles + volume, line, bar, pie, waterfall, heatmap, order book…). Use when the user wants a chart, or a series is hard to read as a table."
match_text: "Vẽ biểu đồ màu trong terminal từ dữ liệu tool đã có (nến + khối lượng, đường giá, bar, pie, waterfall, heatmap, sổ lệnh…). Dùng khi người dùng muốn xem biểu đồ, hoặc khi chuỗi số khó đọc dạng bảng và cần trực quan hóa."
activation: auto
requires_tools: [chart_render]
uses_tools: [chart_render]
triggers:
  keywords: [vẽ biểu đồ, vẽ chart, vẽ nến, biểu đồ nến, biểu đồ, đồ thị, candlestick, sparkline, heatmap, gauge, donut, histogram, waterfall, multiline, boxplot, scatter, vẽ sổ lệnh]
version: 1.1.1
---

# Vẽ biểu đồ màu trong terminal

A display skill: figures always come from tool results in the session, never invented for illustration.

## Các bước

1. **Draw by reference.** Every tool result with array data starts with a `[ref rN]` code. Call `chart_render({from_call: "rN", kind})` (several tickers: `chart_render({kind: "compare", from_calls: ["r1", "r2"]})`) so the harness takes the numbers itself — never retype them one by one. A combined multi-ticker result (one `rN` holding FPT, SHB, NVL): `chart_render({kind: "compare", from_calls: ["rN"]})` splits it per ticker; for one ticker add `from_symbol: "SHB"`. Pass numbers by hand only when the data did not come from a tool.
2. **Not sure which chart** → read `references/choosing-a-form.md`, follow the yes/no tree and STOP at the first matching ★ node. Read only the reference file for that chart type.
3. **Too few points** (the minimum noted in the tree) → report missing data; do not draw.
4. **Comment in 2–3 sentences** from the picture and the numbers (trend, highs/lows, position in the range, units). The picture shows itself in the TUI: do not copy it into the answer.

## Lưu ý

- Prices of several tickers use `chart_render kind=compare` (% change), not one shared `multiline`.
- A pie with more than 7 slices becomes a bar; one value over a total becomes a donut/gauge.
- Always pass `unit` when known (kVND, %, tỷ, triệu cp).
- At most 1 chart per answer, unless the user asks for more.

## File tham khảo

| File | Use when |
|---|---|
| `references/choosing-a-form.md` | Choosing a chart by data shape, and charts to avoid |
| `references/time-series.md` | Candles + volume, price line, area, sparkline |
| `references/comparison.md` | Bar, boxplot, histogram, % comparison |
| `references/part-to-whole.md` | Pie/donut, stacked, waterfall |
| `references/relationship.md` | Scatter, multiline indicators, heatmap |
| `references/anti-patterns.md` | What not to draw |
