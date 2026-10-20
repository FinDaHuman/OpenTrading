# Chỉ báo ngành điện — nhóm nguồn và cách đọc

> File này giữ **cách phân nhóm nguồn** và cách đọc từng chỉ báo, không giữ con số
> kỳ nào. Mọi giá trị lấy từ `financial_detail` / `news_market` gần nhất và ghi kỳ
> kèm theo. Luật về giá điện và cơ chế một người mua chỉ nằm ở §Trụ cột driver của
> SKILL.md — không lặp lại ở đây.

## 1. Phân nhóm nguồn

| Nhóm | Chu kỳ bám | Mùa/quy luận riêng | So với ai |
|---|---|---|---|
| Thủy điện | Mực nước và lưu lượng (thủy văn) | Mùa khô giảm sản lượng, kéo dài nhiều kỳ | Cùng nhóm thủy điện |
| Nhiệt điện (than) | Giá điện + tỷ trọng khai thác + giá than | Khi thủy điện sụt, nhiệt điện chạy bù → tỷ trọng tăng | Cùng nhóm nhiệt |
| Khí / LNG | Giá điện + chi phí khí nhập + tỷ giá | Nhạy với tỷ giá và nhập khẩu trong các nhóm nhiệt | Cùng nhóm khí |
| Truyền tải / thiết bị | Chi tiêu đầu tư lưới, quy hoạch | Theo chu kỳ đầu tư công, không theo mùa khô | Cùng nhóm thiết bị |

## 2. Nhóm dòng thu và công nợ

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu | `financial_detail` | Đọc cùng sản lượng: doanh thu tăng do giá hay do khối lượng |
| Phải thu người mua bán điện | `financial_detail` | **Chỗ chứa rủi ro chính của ngành**: tăng nhanh hơn doanh thu = giá bán phía sau không đủ chi phí |
| Biên lãi gộp | `financial_detail` | Đọc theo nhóm nguồn; biên hợp nhất che sự chênh lệch giữa thủy/khí/nhiệt |
| Chi phí tài chính | `financial_detail` | Dự án BOT có vốn vay lớn: chi phí lãi cố định khi chưa vận hành |

## 3. Nhóm sản lượng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Sản lượng kỳ | `news_market` (công bố ngành/công ty) | Đọc kèm cơ cấu nguồn: sản lượng giảm có thể do khan hiếm nguồn, không phải nhu cầu giảm |
| Tỷ trọng khai thác | `news_market` | Quyết định lợi nhuận nhóm nhiệt khi thặng dư đủ |
| Tỷ lệ sử dụng công suất | `news_market` | Nhà máy mới chưa đủ tải chi phí cố định |

## 4. Nhóm đối chiếu bên ngoài

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `news_market` | Cơ cấu phát điện theo kỳ, mực nước hồ chứa, khung giá và điều chỉnh, tiến độ dự án | Số ngành; ghi rõ nguồn và kỳ |
| `yf_commodities` | Giá than, khí tham chiếu quốc tế | Chi phí đầu vào nhóm nhiệt/khí — giá tham chiếu, không phải giá hợp đồng |
| `company_events` | Sự kiện dự án, hợp đồng mua bán điện mới | Xác nhận dòng thu tương lai |
| `planned_targets` | Kế hoạch sản lượng/doanh thu/lãi | Neo kỳ vọng và đối chiếu kết quả |

## 5. Bẫy đọc thường gặp

- Nhu cầu điện tăng nhưng một nhà máy lãi giảm: xem giá điện và công nợ trước khi
  kết luận "quản trị kém".
- So nhóm thủy với nhóm nhiệt trong cùng một kỳ: hai chu kỳ khác nhau, kết luận sẽ
  ngược.
- Doanh thu tăng nhờ một lần bù giá: đánh dấu một lần, không nội suy.
