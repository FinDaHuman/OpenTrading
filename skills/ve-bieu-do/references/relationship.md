# Tương quan: scatter, multiline chỉ số, heatmap

## Scatter phân nhóm

- Input: `points` (x, y, ≥3 điểm) + `groups` (nhóm từng điểm) + `labels` (tên nhóm).
- Braille cell không phóng to chấm được → phân biệt bằng MÀU + legend
  (mỗi nhóm 1 màu, legend đếm điểm: `● VCB (7 điểm)`).
- Domain X+Y CHUNG toàn bộ groups (tự tính, không lệch overlay).
- Trục X ghi range x (vd khối lượng 5.0M … 14.0M).

## Multiline CHỈ SỐ (không phải giá)

- Input: `matrix` (mỗi dòng 1 series) + `labels` + `times`.
- Chỉ dùng cho chỉ số CÙNG đơn vị (RSI, Stochastic, PE, PB...).
- CẤM vẽ giá nhiều mã (lệch magnitude → xẹp hình) — giá nhiều mã dùng `chart_compare`.
- Mỗi series 1 màu + legend giá trị cuối. Padding top 20% / bottom 10%.

## Heatmap gradient

- Input: `matrix` 2D + labels (hàng rồi cột).
- Nền gradient xanh (thấp) → đỏ (cao) theo `mix()`, chữ trong cell contrast
  (sáng trên nền đậm). Tiêu đề hàng + cột đầy đủ.
