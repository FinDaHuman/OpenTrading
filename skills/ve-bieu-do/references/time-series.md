# Time-series: nến, line, area, sparkline

Chuẩn TradingView (lightweight-charts scaleMargins mặc định): padding giá
top 20% / bottom 10% — đường/nến không chạm viền.

## Candlestick + volume

- Input: `bars: [{o, h, l, c, v?}]` (≥5 nến) + `times` (ngày, vd 09-01).
- Có `v` → pane volume 4 dòng dưới giá, cùng cột nến, màu theo hướng nến
  (xanh lá tăng / đỏ giảm), tiêu đề ghi tổng Vol.
- Nến compact dính liền: mỗi nến 2 cột (thân + khoảng).
- Trục X khớp cột nến: ngày đầu dưới nến đầu, ngày cuối dưới nến cuối.
  Date quá dài/chật → quay dọc (mỗi ký tự một dòng tại cột nến).

## Trục X (mọi chart time-series)

- Đường ngang `└───` + chấm `●` tại đúng cột từng điểm thời gian.
- Nhãn ngày: đầu trái — cuối phải (dài/chật thì quay dọc).
- `┤` cố định cột 7, plot rộng cố định → trục X các chart thẳng hàng khi so sánh.

## Line / area / sparkline

- Input: `series` (≥2 điểm) + `times` trục X + `unit` (vd kVND, hiện `[unit]` ở tiêu đề).
- Line braille mượt, màu theo trend (lên xanh / xuống đỏ).
- Area = line ký tự box bo góc (╭╮╰╯) + fill mờ dưới đường (nội suy cột trống).
- Sparkline = đường mini braille cao 4 dòng (không phải dải khối).
- Sparkcolumn = cột cao 6 dòng; `dirs` (hướng giá từng cột) để tô xanh/đỏ
  theo giá — volume luôn dương nên tô theo dấu thì toàn xanh.
