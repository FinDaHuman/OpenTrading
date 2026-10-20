# Chỉ báo ngành thép — dòng báo cáo và cách đọc

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `yf_commodities` / `news_market` gần nhất và ghi kỳ kèm
> theo. Luật về đọc spread theo độ trễ tồn kho chỉ nằm ở §Trụ cột driver của
> SKILL.md — không lặp lại ở đây.

## 1. Nhóm đầu ra

| Chỉ báo | Đón từ | Cách đọc |
|---|---|---|
| Doanh thu | `financial_detail` | Tách phần tăng do giá và do khối lượng nếu công bố cho phép; cùng mức doanh thu có thể là giá lên hoặc khối lượng lên |
| Giá vốn hàng bán | `financial_detail` | Nơi chứa giá nguyên liệu. Tăng nhanh hơn doanh thu = biên đang nén |
| Biên lãi gộp | `financial_detail` (hoặc tự tính, ghi rõ) | Đọc theo quý liên tiếp; một quý nén có thể là giãn tồn kho, không phải xấu |
| Chi phí tài chính phục vụ tồn kho | `financial_detail` | Tồn kho lớn + lãi suất cao = chi phí mang vốn nặng, đặc biệt khi nguyên liệu nhập |

## 2. Nhóm đầu vào

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Giá quặng sắt | `yf_commodities` | Giá tham chiếu quốc tế theo chu kỳ — ghi rõ kỳ và là giá tham chiếu, không phải giá hợp đồng |
| Giá than cốc | `yf_commodities` | Biến động mạnh hơn quặng; thường là nguyên nhân chính bóp biên trong nửa năm |
| Giá thép tham chiếu quốc tế | `yf_commodities` / `news_market` | Dùng cho nhóm sản phẩm giao dịch quốc tế, **không** thay giá bán trong nước |

## 3. Nhóm khối lượng và công suất

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Sản lượng bán theo nhóm | `news_market` / báo cáo nhà máy | Phân biệt sản phẩm nội địa với sản phẩm giao dịch quốc tế — hai logic giá |
| Tỷ lệ sử dụng công suất | `news_market` / báo cáo nhà máy | Nhà máy mới chưa đủ công suất làm biên thấp dù doanh thu cao |
| Tồn kho nguyên liệu | `financial_detail` | Quyết định độ trễ chi phí: tồn kho giá cao còn chưa tiêu thì biên còn bị nén thêm |

## 4. Nhóm thương mại

| Nguồn | Đọc gì | Khi nào |
|---|---|---|
| `news_market` | Văn bản phòng vệ thương mại (thuế, phạm vi, thời hạn), nhập khẩu, khởi công/dự án mới | Mỗi lần kết luận về giá bán hoặc thị phần |
| `vs_xnk_detail` | Xuất khẩu thép và sản phẩm thép theo kỳ | Khi cần đo tỷ trọng xuất khẩu và cửa xả dư thừa |
| `planned_targets` | Kế hoạch doanh thu/lãi/sản lượng | Neo kỳ vọng của công ty |
| `peer_compare` | Biên lãi gộp, chi phí tài chính/tổng nợ trong nhóm | So cùng nhóm phân khúc sản phẩm |

## 5. Bẫy đọc thường gặp

- Doanh thu tăng nhưng lãi giảm: xem spread trước khi kết luận "quản trị kém".
- Giá thành phẩm quốc tế đang lên trong khi giá bán trong nước giảm: đó là tín
  hiệu rào phòng vệ đang yếu đi, không phải cơ hội.
- Biên một quý phục hồi mạnh: kiểm tra có phải giãn tồn kho giá rẻ không trước khi
  nội suy thành xu hướng.
