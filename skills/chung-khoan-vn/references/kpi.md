# Chỉ báo ngành chứng khoán — dòng BCTC và cách đọc

> Tra `vs_financial_norms(btype=2)` để lấy đúng tên dòng BCTC loại chứng khoán; file
> này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ `financial_detail`
> gần nhất và ghi kỳ báo cáo kèm theo. Luật về trần ký quỹ và cách tính mức đòn
> bẩy chỉ nằm ở §Trụ cột driver của SKILL.md — không lặp lại ở đây.

## 1. Nhóm đòn bẩn

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Dư nợ cho vay ký quỹ | `financial_detail` | Xu hướng 4–8 quý. Tăng đều = nhận thức rủi ro đang mở; giảm đột ngột = thị trường vừa xả hoặc CTCK siết gọi |
| Vốn chủ sở hữu | `financial_detail` | Dùng làm mẫu số cho mức đòn bẩy. Vốn giảm vì cổ tức bằng cổ phiếu làm mức đòn bẩy tăng ảo — ghi rõ |
| Mức đòn bẩy | Tự tính: dư nợ / vốn chủ (ghi rõ tự tính) | So trần quy định hiện hành. Đây là chỉ báo **chỗ tăng trưởng còn lại**, không phải chỉ báo chất lượng |
| Các khoản phải thu | `financial_detail` | Phải thu từ giao dịch margin tăng nhanh hơn dư nợ = công nợ đang ùn lại |

## 2. Nhóm doanh thu

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu môi giới | `financial_detail` | Phí đang bị nén cấu trúc bởi cạnh tranh phí 0. Doanh thu môi giới giảm **không** đồng nghĩa ngành xấu |
| Doanh thu cho vay ký quỹ | `financial_detail` | Đọc kèm dư nợ và lãi suất trung bình: doanh thu tăng nhưng dư nợ giảm = lãi suất tăng, không phải khối lượng |
| Doanh thu đầu tư | `financial_detail` | Mảng biến động nhất. Đọc 4 quý và tách phần thực hiện lãi định kỳ |
| Doanh thu tư vấn | `financial_detail` | Mảng nhỏ nhưng ổn định nhất; tăng theo pipeline IPO/ECM |
| Tỷ trọng 4 mảng | Tự tính (ghi rõ) | Cơ cấu quyết định nhóm nào chịu thị trường giảm. Đọc 4 quý liền mới xếp nhóm |

## 3. Nhóm vốn và hiệu quả

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| ROE | `financial_ratios` | Dùng làm mẫu số cho P/B. ROE từ tự doanh lên bất thường thì giảm trọng số kỳ đó |
| Chi phí hoạt động | `financial_detail` | So với doanh thu: chi phí tăng nhanh hơn doanh thu là ép biên dài hạn |
| Trích lãi | `financial_detail` | So với ngưỡng quy định hiện hành cho mảng ký quỹ, không so với trí nhớ |

## 4. Nhóm đối chiếu

| Nguồn | Đọc gì | Khi nào |
|---|---|---|
| `news_market` | Dư nợ margin toàn ngành, lãi margin trung bình, chi phí vốn CTCK | Mỗi lần cần số ngành; ghi rõ số ngành lấy từ công bố nào |
| `market_overview` | Giá bluechip, movers, độ rộng | Cần bối cảnh nhịp phiên trước khi đọc kết quả CTCK |
| `breadth_scan` | Độ rộng tăng/giảm | Kiểm tra câu chuyện thanh khoản có lan tỏa hay chỉ vài mã lớn |
| `planned_targets` | Kế hoạch năm (doanh thu, lợi nhuận, vốn) | Neo kỳ vọng; đặc biệt cần khi xét vấn đề huy động vốn mở rộng |

## 5. Bẫy đọc thường gặp

- Doanh thu môi giới giảm trong khi ngành vẫn lãi: đừng kết luận "ngành xấu" —
  cạnh tranh phí là cấu trúc, không phải chu kỳ.
- Dư nợ ký quỹ tăng cùng lúc với thị trường chỉ là hệ quả, không kéo theo lãi
  CTCK bằng vốn chủ mới.
- Quý lãi bất thường từ tự doanh: xử lý như một lần, không nội suy thành năng lực.
