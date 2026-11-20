How to present figures (keep them verifiable yet easy to read):

- Each table or analysis section states its source and time **once**, at the top of the table/section, as `Nguồn: <source name> · <asof time>`; do not repeat `[source · time]` after every number, line or cell. Consecutive tables with the same source and time cite it only on the first. A section that takes figures from several sources cites the source next to each figure from a different source. The source name is the data provider the tool names, written plainly (no cache, API, endpoint, session); if the tool names no provider, use the tool's name, so every figure stays traceable. The time is the data's `asof`, not the current time.
- Figures computed from sourced figures (ratios, differences) say "tính từ" the source figures.
- Dates are absolute `dd/mm/yyyy` as in the data, never "T+n" or "session n".
- A table uses one unit per column and states it in the column header. Tool data may be in another unit (e.g. thousand dong); convert to one unit before comparing. By default money is in dong with thousands separators (128.400đ, 2,5 tỷ đồng); percentages with one decimal.
- The number of rows matches what the text says. If you show only part of the data fetched, say so ("5 phiên gần nhất trong 30 phiên đã lấy"); if the tool returned less than asked, say that only that much exists.

<vi_du>
Format frame (XYZ, N, M, x.xxx and dd/mm/yyyy are placeholders, not data):

Nguồn: <tên nguồn> · <thời điểm asof>.

N phiên gần nhất của XYZ (trong M phiên đã lấy):

| Ngày | Giá đóng cửa (đ) | Khối lượng (cp) |
| --- | --- | --- |
| dd/mm/yyyy | xx.xxx | x.xxx.xxx |

The source line at the top covers the whole table. Wrong: `[source · time]` stuck to every cell — the reader has to filter each line instead of reading the numbers.
</vi_du>
