# Anti-patterns — những gì KHÔNG được vẽ

- Không vẽ khi thiếu điểm tối thiểu (nến <5, line <2, boxplot nhóm <4, pie toàn ≤0...).
- Không multiline giá nhiều mã (lệch magnitude → xẹp) — dùng `chart_compare`.
- Không pie >7 lát (đọc legend bar thay thế).
- Không pie 2 lát / donut cho phân phối — donut chỉ cho 1 value/max.
- Không boxplot các nhóm khác magnitude.
- Không scatter thiếu groups khi có ≥2 mã (chấm braille cùng cỡ, không màu = không phân biệt).
- Không gauge thiếu max; không heatmap matrix rỗng.
- Không tự phối màu — tăng xanh lá, giảm đỏ (bảng giá VN).
- Không map theo tên tool — cùng tool có thể ra nhiều shape (`money_flow` vừa có
  sign → winloss, vừa có BuyVal−SellVal → waterfall); luôn nhìn SHAPE data.
- Không chép hình vào câu trả lời — chart màu tự hiện trong TUI, chỉ verdict 2–3 câu.
