# Tỷ trọng: pie, donut, stacked, waterfall

## Pie THANH TỶ LỆ 100%

- Input: `series` + `labels` (≥2 lát, ít nhất 1 lát >0; lát ≤0 bị bỏ).
- Một thanh ngang full-width chia segment theo % (lát nhỏ nhất ≥1 ký tự,
  phần dư dồn vào lát lớn nhất), mỗi lát 1 màu + legend (hộp màu + tên + %).
- Tổng các lát phải ≈100%.

## Donut THANH TỶ LỆ (giống pie)

- Input: `value` + `max` (1 số duy nhất).
- Thanh ngang 2 segment: phần đạt xanh + phần còn lại xám + legend
  (tên + %). Dòng trống ngăn cách thanh với legend.

## Stacked

- Input: `matrix` (mỗi hàng 1 nhóm) + labels (hàng nhóm rồi cột thành phần).
- Mỗi thành phần 1 màu + legend dưới. Mỗi hàng là 100% của nhóm đó.

## Waterfall

- Input: `start` + `series` deltas (≥1 bước) + `labels` từng bước.
- Mỗi bước 1 thanh từ tổng cũ → tổng mới (├█┤ xanh tăng / ├░┤ đỏ giảm),
  ghi delta và running total. Dòng trống giữa các bước.
- Hàng đầu `Bắt đầu │` và cuối `Kết thúc │`.
