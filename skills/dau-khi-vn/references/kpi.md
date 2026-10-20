# Chỉ báo ngành dầu khí — tách vòng kinh doanh và cách đọc

> File này giữ **bốn vòng kinh doanh khác nhau** và cách đọc từng vòng, không giữ
> con số kỳ nào. Mọi giá trị lấy từ `financial_detail` / `yf_commodities` /
> `news_market` gần nhất và ghi kỳ kèm theo. Luật về không đặt ngành vào chuỗi luân
> chuyển chỉ nằm ở §Ranh giới của SKILL.md — không lặp lại ở đây.

## 1. Tách vòng kinh doanh

| Vòng | Đặc điểm nhận dạng | Chu kỳ bám | So với ai |
|---|---|---|---|
| Thượng nguồn (khai thác) | Sản lượng khai thác, trữ lượng, chi phí thăm dò | Giá dầu + trữ lượng | Cùng vòng thượng nguồn |
| Lọc hoá dầu | Doanh thu bán sản phẩm lọc − giá dầu thô đầu vào | Chênh lệch tinh chế | Cùng vòng lọc dầu |
| Vận chuyển | Cước tàu, hợp đồng thuê | Cước tàu + độ dài đường đi | Cùng vòng vận chuyển |
| Dịch vụ kỹ thuật | Doanh thu hợp đồng, backlog | Chi tiêu đầu tư của tập đoàn | Cùng vòng dịch vụ |

Bước bắt buộc trước khi so sánh: xác định vòng nào nuôi lãi của mã bằng mảng trong
`financial_detail` + bảng mảng trong `vn_company`. Không rõ → xử lý như nhiều vòng
và đọc cả các nhánh, không chọn một vòng đại diện.

## 2. Nhóm biên theo vòng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu hợp nhất | `financial_detail` | Đọc kèm cơ cấu mảng: doanh thu tăng nhưng không nói được vòng nào kéo là vô nghĩa |
| Biên lãi gộp theo mảng (nếu công bố) | `financial_detail` | Chỉ báo cốt lõi. Biên hợp nhất che sự dịch chuyển giữa các vòng |
| Chi phí thăm dò | `financial_detail` | Xu hướng 4 quý: chi tiêu tăng báo hiệu sản lượng tương lai; chi tiêu cắt báo hiệu suy giảm về sau |
| Tỷ lệ chi phí | `financial_detail` (tự tính, ghi rõ) | Tỷ lệ thấp khi giá dầu cao không phải năng lực — đo lại ở vùng giá thấp |

## 3. Nhóm khối lượng và trữ lượng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Sản lượng kỳ | `news_market` (công bố ngành/công ty) | Bù đắp trữ lượng chỉ có nghĩa khi đọc cạnh sản lượng |
| Trữ lượng bù đắp | `news_market` | Thấp hơn sản lượng liên tiếp = sản lượng đang tiêu từ trữ lượng cũ |
| Thứ tự dự án / khởi công | `company_events` · `news_market` | Quyết định sản lượng 2–5 năm tới; thứ tự lùi làm dòng thu trễ |
| Hợp đồng dài hạn | `news_market` | Co giãn thu nhập qua chu kỳ; tỷ trọng cao giảm nhạy giá ngắn hạn |

## 4. Nhóm giá và tuyến

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `yf_commodities` | Giá dầu theo chu kỳ tra được | Làm mốc đối chiếu, **không** thay giá thực hiện hợp đồng |
| `news_market` | Tình trạng tuyến vận chuyển, cước tàu dầu, diễn biến địa chính trị | Driver của vòng vận chuyển; ghi rõ ngày nguồn |
| `planned_targets` | Kế hoạch năm của công ty | Neo kỳ vọng sản lượng/doanh thu |
| `peer_compare` | Chỉ báo trong cùng vòng | Cấm so vòng khác; ghi rõ vòng đang so |

## 5. Bẫy đọc thường gặp

- Tin giá dầu thì "cả ngành cùng hưởng": sai — lọc dầu có thể đi ngược, dịch vụ
  đi sau 6–12 tháng.
- Doanh thu tăng vì một giao dịch bất thường trong kỳ: đánh dấu là một lần, không
  nội suy.
- Sản lượng hiện tại đẹp: kiểm tra bù đắp trữ lượng trước khi kết luận bền vững.
