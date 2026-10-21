# Chỉ báo ngành hoá chất & phân bón — cách đọc theo cửa sổ giá

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `news_market` / `yf_commodities` gần nhất và ghi kỳ kèm
> theo. Luật về cửa sổ giá và tồn kho giá gốc chỉ nằm ở mục "Trụ cột driver"
> của SKILL.md — không lặp lại ở đây.

## 1. Phân biệt nội địa và quốc tế

| Tiêu chí | Bán nội địa | Xuất khẩu |
|---|---|---|
| Giá bám | Khung giá trong nước + nhu cầu nội địa | Giá quốc tế theo thời điểm giao dịch |
| Biến quyết định | Nhu cầu nông nghiệp + giá nông sản | Cú sốc cung + chính sách xuất khẩu |
| Chu kỳ | Chậm hơn, êm hơn | Nhanh và biến động mạnh |
| Đọc gì | Sản lượng bán nội địa + giá bán trong nước | Tỷ lệ xuất + giá quốc tế + tồn kho |

## 2. Nhóm giá và biên

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu | `financial_detail` | Tách giá và khối lượng nếu công bố cho phép; tăng do giá không bền bằng tăng do khối lượng |
| Giá bán bình quân | Tự tính (ghi rõ) hoặc công bố công ty | Đối chiếu giá quốc tế/nội địa để xem công ty có nhận đủ cửa sổ không |
| Biên lãi gộp | `financial_detail` | Đọc **2 quý liền**: một quý mở rộng có thể là tồn kho giá gốc thấp |
| Giá vốn | `financial_detail` | Nơi chứa chi phí khí/nguyên liệu; đọc cùng tồn kho |

## 3. Nhóm cửa sổ giá

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Tồn kho | `financial_detail` | Đọc theo luật ở §Trụ cột driver của SKILL.md (tồn kho giá gốc quyết định biên còn được hỗ trợ bao lâu): tồn kho giá gốc thấp thì biên còn đỡ, giá gốc cao thì biên bị nén khi giá giảm |
| Chi phí khí/nguyên liệu | `financial_detail` + `yf_commodities` | Đuổi kịp giá bán thì cửa sổ đóng |
| Xuất khẩu kỳ | `vs_xnk_detail` | Tín hiệu hướng: xuất tăng mạnh thường đi kèm giá quốc tế tốt |
| Chính sách Trung Quốc | `news_market` | Biến số cung toàn cầu; ghi rõ nguồn và ngày |

## 4. Nhóm đối chiếu

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `news_market` | Giá phân bón quốc tế/nội địa, chính sách xuất khẩu, tình trạng cung | Ghi rõ chỉ số giá và ngày tra |
| `vs_indicator_data` | Sản xuất nông nghiệp (nhu cầu nội địa) | Chỉ dùng khi xét nhánh nội địa |
| `planned_targets` | Kế hoạch sản lượng/doanh thu/lãi | Neo kỳ vọng |
| `peer_compare` | Biên lãi gộp, tỷ lệ xuất, chi phí đầu vào | So trong cùng nhóm sản phẩm (ure vs NPK vs phân kali) |

## 5. Bẫy đọc thường gặp

- Một quý lãi nhảy mạnh: kiểm tra tồn kho giá gốc trước khi nội suy thành năng lực.
- Giá quốc tế lên nhưng công ty bán nội địa: khung giá trong nước giới hạn phần
  được tăng — verdict khác công ty xuất khẩu.
- Chính sách Trung Quốc nới ra: cả nhóm chu kỳ giá bị kéo xuống dù công ty chưa xuất
  khẩu sang Trung Quốc.
