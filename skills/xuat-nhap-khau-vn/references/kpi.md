# Chỉ báo xuất nhập khẩu — nhóm hàng, nguồn và chỉ báo dẫn

> File này giữ **cách đọc**, không giữ số kỳ nào. `vs_xnk_detail` trả số **theo nước**;
> số theo nhóm hàng lấy từ công bố của Tổng cục Thống kê, Hải quan qua `web_search`. Luật
> về tra mức thuế nằm ở mục "Ranh giới" của SKILL.md.

## 1. Nhóm hàng

| Nhóm | Bám theo | Đọc thuế |
|---|---|---|
| Điện tử, linh kiện, máy tính | Chu kỳ công nghệ toàn cầu, công suất nhà máy FDI | Kiểm tra danh sách miễn trừ và thuế theo mặt hàng |
| Máy móc, thiết bị | Đầu tư công suất | Nhập khẩu nhóm này là chỉ báo dẫn cho nhóm khác |
| Dệt may, giày dép | Đơn hàng mùa, tồn kho nhà bán lẻ nước ngoài | Chênh lệch thuế theo nước so với đối thủ; quy tắc xuất xứ nguyên liệu |
| Đồ gỗ | Thị trường nhà ở nước nhập khẩu | Thuế theo mặt hàng, điều tra chống bán phá giá |
| Nông, thuỷ sản | Mùa vụ, giá thế giới | Kiểm dịch, chống bán phá giá, hạn ngạch |
| Thép, nhôm, phân bón | Giá hàng hoá | Thuế theo mặt hàng, thuế carbon biên giới EU |

## 2. Nguồn từng chuỗi

| Chuỗi | Nguồn | Ghi chú |
|---|---|---|
| Tổng xuất khẩu | `vs_indicator_data(indicator="XK")` | Có preset |
| Xuất/nhập theo nước | `vs_xnk_detail(direction="xk" / "nk")` | Theo nước, không theo nhóm hàng |
| Xuất/nhập theo nhóm hàng | `web_search` (Tổng cục Thống kê, Hải quan) | Ghi kỳ và tên nhóm đúng như nguồn |
| FDI đăng ký, giải ngân | `vs_categories` → `vs_indicator_data(category_id, term_type_id)` | Cặp category/term_type phải khớp metadata; không có thì `web_search` |
| Tỷ giá USD/VND | `vn_forex_ohlcv(pair="USDVND")` | Bối cảnh trị giá quy đổi và chi phí nhập |

## 3. Cặp nhập – xuất (chỉ báo dẫn)

| Chỉ báo | Cách đọc |
|---|---|
| Nhập máy móc, linh kiện cùng nhóm tăng vài quý trước | Công suất mới đang triển khai — xuất khẩu nhóm đó có nền tăng |
| Xuất khẩu hàng công nghệ | Đi sau nhập máy móc; đọc cặp để tránh kết luận "chững" quá sớm |
| Nhập nguyên liệu (vải, da) cho dệt may, giày | Tăng = đơn hàng các tháng tới đã được đặt |

## 4. Riêng doanh nghiệp

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu theo thị trường | TM | Tỷ trọng Mỹ, EU… cho biết mức chịu thuế |
| Hàng tồn kho, phải thu | CDKT | Tăng nhanh hơn doanh thu = đơn hàng ùn hoặc khách trả chậm |
| Vay ngoại tệ | TM | Nhạy tỷ giá — đọc cùng USD/VND |

## 5. Bẫy đọc thường gặp

- Tổng xuất khẩu tăng hai con số rồi kết luận "cả nền kinh tế khoẻ": kiểm tra phân bổ
  theo nhóm hàng và khu vực FDI trước.
- Nhập khẩu tăng bị đọc là "xấu": với hàng công nghệ, nhập máy móc trước xuất khẩu là
  tín hiệu tốt.
- Lẫn "dòng vốn nước ngoài" trên sàn chứng khoán (khối ngoại) với FDI: hai thứ khác hẳn.
