# Chỉ báo ngân hàng — nguồn, công thức và kỳ so sánh

Tra `vs_financial_norms(btype=3)` trước khi chọn dòng ngân hàng. Mỗi lời gọi
`financial_detail` nhận một `statement`: `KQKD`, `CDKT` hoặc `TM`. Tên dòng thực tế
phải khớp kết quả tra; tỷ lệ không có sẵn cần tính từ thuyết minh hoặc công bố ngân hàng.
Không truyền `btype` vào `financial_detail`. Ghi rõ đơn vị, kỳ và công thức tự tính.

## Thu nhập và hiệu quả

| Chỉ báo | Nguồn/công thức | Lưu ý |
|---|---|---|
| Thu nhập lãi, chi phí lãi, thu nhập lãi thuần | `KQKD`; thu nhập lãi thuần = thu nhập lãi − chi phí lãi | Không dùng tên dòng “chi phí thu nhập lãi thuần” |
| NIM | Thu nhập lãi thuần quy đổi năm / tài sản sinh lãi bình quân | Quý độc lập ×4; YTD n tháng ×12/n; TTM không nhân. Nếu KQKD là lũy kế, trừ kỳ trước để ra quý độc lập. Bình quân số dư đầu/cuối đúng kỳ thu nhập, hoặc bình quân quý nếu có đủ dữ liệu; ghi phương pháp. Không chia cho tổng tài sản hoặc số dư cuối kỳ. Thiếu tài sản sinh lãi đầu/cuối thì không tính |
| Lợi suất tài sản sinh lãi | Thu nhập lãi quy đổi năm / tài sản sinh lãi bình quân cùng kỳ | Giữ cùng phạm vi các khoản sinh lãi; đọc với chi phí vốn |
| Chi phí vốn | Chi phí lãi quy đổi năm / nguồn vốn chịu lãi bình quân cùng kỳ | Mẫu số khác NIM; chênh lợi suất và chi phí vốn không đồng nhất NIM |
| Thu nhập ngoài lãi | Tổng các mảng ngoài lãi trong KQKD | Tách phí, kinh doanh ngoại hối, chứng khoán, khoản một lần |

## Chất lượng tài sản

| Chỉ báo | Nguồn/công thức | Lưu ý |
|---|---|---|
| Nợ xấu (NPL) | `TM`: nợ nhóm 3–5 / tổng dư nợ cùng phạm vi | So cả số tuyệt đối và tỷ lệ |
| Nợ nhóm 2 | `TM`: nợ nhóm 2 / tổng dư nợ cùng phạm vi | Chỉ báo sớm; không tự suy tỷ lệ chuyển nhóm từ hai số dư cuối kỳ |
| Bao phủ nợ xấu | Dự phòng cho vay khách hàng / nợ nhóm 3–5, cùng phạm vi và kỳ | Không gọi là bao phủ nợ vay; ghi rõ dự phòng chung/cụ thể theo công bố |
| Chi phí dự phòng rủi ro tín dụng | `KQKD` | So với lợi nhuận trước dự phòng; credit cost cần chi phí quy đổi năm / dư nợ bình quân |
| Ngoại bảng | `TM` hoặc công bố ngân hàng | Bảo lãnh/cam kết không đồng nghĩa đã thành nợ xấu; chỉ dùng tín dụng tương đương nếu có hệ số chuyển đổi phù hợp |

## Tăng trưởng, vốn và thanh khoản

| Chỉ báo | Nguồn/công thức | Lưu ý |
|---|---|---|
| Tăng trưởng tín dụng YTD | `CDKT` so cuối năm trước; công bố hạn mức nếu có | Vẫn mô tả tăng trưởng quan sát được khi thiếu hạn mức, nhưng không suy dư địa hành chính |
| Tăng trưởng tiền gửi YTD | `CDKT` so cuối năm trước | Tín dụng tăng nhanh hơn tiền gửi là khoảng chênh dương có thể gây áp lực huy động; cần xét vốn liên ngân hàng/giấy tờ có giá |
| CASA | Tiền gửi không kỳ hạn khách hàng / tổng tiền gửi khách hàng, `TM` cùng phạm vi | Không trộn tiền gửi liên ngân hàng; không so khác cơ sở |
| LDR | Công bố ngân hàng hoặc tính theo đúng định nghĩa văn bản áp dụng | Tỷ lệ cho vay/tiền gửi kế toán không tự tương đương LDR pháp lý |
| CAR | Công bố an toàn vốn ngân hàng, nguồn và kỳ rõ | Vốn tự có đủ điều kiện / tài sản có rủi ro theo phương pháp áp dụng; không suy từ vốn chủ/tổng tài sản |
| Vốn chủ sở hữu | `CDKT` | Là chỉ tiêu kế toán, không thay vốn tự có pháp lý hoặc chứng minh đáp ứng CAR |

## So sánh

So QoQ/YoY và 4–8 quý cùng cơ sở trước khi so ngân hàng cùng phân khúc.
`peer_compare` chỉ cung cấp key tổng quan thực trả như P/B, ROE; tham số `metrics`
không tạo NIM/CASA/NPL. Lấy các KPI này từ `financial_detail`/công bố từng peer cùng kỳ.
Thiếu dữ liệu hoặc thay đổi mẫu số thì ghi hạn chế, không bù số hay suy tỷ lệ di cư nợ.
