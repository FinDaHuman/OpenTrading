# So sánh: bar, boxplot, histogram, compare, winloss

## Bar diverging

- Input: `series` + `labels`. Âm TRÁI, dương PHẢI.
- Gốc 0 CHUNG: vạch `│` cùng cột mọi dòng (bar tự cap để chừa chỗ số).
- Số nằm ngay sát thanh của nó: âm `-8 █████` bên trái, dương `█████ 25` bên phải.
- Viền đen quanh khối + vạch ngăn `├─┤` giữa các thanh.
- Nhãn dài tự wrap nhiều dòng (full tên); mọi khối cao bằng nhau, nội dung canh giữa.

## Boxplot (chuẩn)

- Input: `matrix` — mỗi dòng 1 NHÓM CÙNG magnitude (vd lợi suất % các mã).
  Khác magnitude → box xẹp, không đọc được.
- Mỗi nhóm ≥4 điểm. Box cao 3 dòng: râu ngang chỉ dòng giữa, mũ `│` hai đầu râu,
  box `█` Q1–Q3 đầy 3 dòng, median là đường dọc `┃` xuyên box + legend
  `┃ median (trung vị)`.
- Dòng giữa ghi min ─ Q1 ─ median ─ Q3 ─ max.

## Histogram

- Input: `series` (≥5 điểm). Bins tự động Sturges (4–12) — ít bins trống.
- Viền đen + vạch ngăn giữa các bins. Mỗi bin ghi khoảng + count.

## Winloss

- Input: `series` giá trị từng phiên (≥2) — dấu = thắng/thua, số = biên độ.
- Mỗi phiên 1 dòng: `Phiên 1 ▲ thắng +4.5` / `▼ thua -2.4` (số luôn kèm dấu).
- Text thuần cũng hiện số (để đọc verdict), không chỉ ▲▼.

## Compare % (chart_compare, tool riêng)

- Input 2–5 chuỗi `{label, values}` (dài ngắn khác nhau được, căn điểm cuối).
- Mỗi mã cao 9 dòng braille + TRỤC Y RIÊNG (nhãn thang từng chart) + header
  `● tên +cuối%` + dòng trống giữa các mã.
- `ymin`/`ymax` tùy biến để cố định thang khi so nhiều kỳ; `times` trục X;
  thang % in ở tiêu đề, `unit` hiện `[%]`.
