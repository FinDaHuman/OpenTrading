# Chỉ báo ngành điện — loại nguồn và cách đọc

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật "chỉ so trong cùng loại nguồn" nằm ở mục "Ranh giới"
> của SKILL.md; cột "So với" dưới đây chỉ là cách áp dụng.

## 1. Loại nguồn

| Loại | Bám theo | Đọc thêm | So với |
|---|---|---|---|
| Thuỷ điện | Lượng nước về hồ, mùa mưa/khô | Sản lượng theo tháng, mực nước hồ | Thuỷ điện |
| Nhiệt điện than | Huy động, giá than, giá bán theo hợp đồng | Sản lượng hợp đồng, chi phí nhiên liệu | Nhiệt điện than |
| Điện khí, LNG | Giá khí, tỷ giá, huy động | Cơ chế chuyển chi phí khí vào giá bán | Điện khí |
| Gió, mặt trời | Giá mua điện, cắt giảm công suất, gió/nắng | Hợp đồng, công suất bị cắt | Tái tạo |
| Xây lắp, thiết bị, truyền tải | Đầu tư lưới và nguồn theo quy hoạch | Giá trị hợp đồng mới, backlog | Xây lắp – thiết bị |

## 2. Dòng BCTC

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu, giá vốn, biên lãi gộp | KQKD | Đọc cùng sản lượng: doanh thu đổi do giá hay do sản lượng |
| Phải thu khách hàng | CDKT (chi tiết người mua ở TM nếu có) | Tăng nhanh hơn doanh thu = tiền bán điện về chậm |
| Số ngày phải thu (tự tính) | CDKT + KQKD | Phải thu bình quân / doanh thu quý × 90; so 4–8 quý |
| Vay, chi phí lãi vay | CDKT, KQKD | Nhà máy mới: lãi vay và khấu hao chạy trước sản lượng |
| Khấu hao | LCTT | Nhà máy hết khấu hao có lợi nhuận kế toán cao hơn — đọc khi so P/E |
| Cổ tức đã trả | LCTT | Thuỷ điện, nhà máy cũ: dòng tiền trả cổ tức là phần lớn giá trị |

## 3. Ngoài BCTC

| Chỉ báo | Nguồn | Cách dùng |
|---|---|---|
| Lần điều chỉnh giá bán lẻ, cơ chế điều chỉnh | `web_search` | Ghi văn bản + ngày |
| Lưu lượng nước về hồ, dự báo mùa | `web_search` | Ghi vùng (Bắc/Trung/Nam) và kỳ |
| Cơ cấu huy động toàn hệ thống | `web_search` | Ghi kỳ; một tháng không đại diện cả mùa |
| Sản lượng của nhà máy | `news_symbol`, công bố công ty | Ghi tháng/quý |
| Giá khí, dầu tham chiếu; tỷ giá | `yf_commodities`, `vn_forex_ohlcv` | Bối cảnh chi phí; không phải giá hợp đồng |

## 4. Bẫy đọc thường gặp

- Nhu cầu điện tăng nhưng nhà máy lãi giảm: xem giá bán, công nợ và huy động trước khi
  nói "quản trị kém".
- So thuỷ điện với nhiệt điện cùng một kỳ: năm nước nhiều thì thuỷ tốt, nhiệt kém.
- Lợi nhuận tăng nhờ một lần (hoàn nhập, thanh lý, bù chênh lệch tỷ giá): đánh dấu
  một lần.
