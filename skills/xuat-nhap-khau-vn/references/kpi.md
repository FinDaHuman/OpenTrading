# Chỉ báo xuất nhập khẩu — phân nhóm hàng, thuế và tỷ giá

`vs_xnk_detail` cho cơ cấu theo nước và tỷ trọng FDI, **không cho chuỗi nhóm hàng**.
Tổng mức xuất khẩu qua `vs_indicator_data` preset `XK`; chỉ tiêu khác phải tra danh
mục và tham số hỗ trợ trước. Nhóm hàng và FDI lấy công bố hải quan/cơ quan thống kê/
cơ quan quản lý đầu tư hoặc báo cáo có nguồn gốc rõ qua `news_market`/`web_search`.
Ghi kỳ, đơn vị, phân biệt lượng và trị giá, số sơ bộ/chính thức.

## Nhóm hàng và đầu tư

| Nhóm/chỉ báo | Nguồn và cách đọc |
|---|---|
| Điện tử, linh kiện, thiết bị | Thống kê hàng hóa hải quan/cơ quan thống kê; đối chiếu đơn hàng, giá và sản lượng. Không tự coi điện tử được miễn thuế |
| Dệt may, giày, thủ công | Thống kê hàng hóa cùng kỳ; kiểm tra mùa vụ và cầu. Không mặc định nhóm này đi ngang hay không được miễn thuế |
| Nông, lâm, thủy sản | Sản lượng, đơn giá, kiểm dịch, hạn ngạch và biện pháp thương mại theo từng nhóm |
| Nhập thiết bị/máy móc | Thống kê hàng hóa; tăng có thể do đầu tư mới, thay thế hoặc tái xuất. Cần dự án và tiến độ xác nhận công suất |
| Nhập linh kiện/nguyên liệu | Thống kê hàng hóa; tăng có thể do giá, tồn kho hoặc sản xuất. Không suy đơn hàng/công suất mới chỉ từ nhập tăng |
| Xuất hàng cùng nhóm | Đối chiếu lượng/giá với nhập theo kỳ; tương quan không chứng minh nhân quả hoặc cùng doanh nghiệp |
| FDI đăng ký/giải ngân | Công bố cơ quan quản lý đầu tư hoặc chỉ tiêu tool đã xác minh; phân biệt đăng ký, giải ngân và công suất đã vận hành |

## Thuế

Lập so sánh cùng sản phẩm và thị trường đích: xuất xứ, mã hàng, thuế cơ sở/đối ứng,
thuế chống bán phá giá/chống trợ cấp hoặc biện pháp ngành, miễn trừ, ngày hiệu lực và
quy tắc cộng dồn. Tra văn bản chính thức đang áp dụng khi phân tích. Không giả định
mức chung đồng đều cho đối tác hay miễn trừ cố định theo nhãn công nghệ. Chưa xác
minh thì ghi thiếu; tỷ trọng miễn cần mẫu số trị giá đúng phạm vi, không bịa ước lượng.

## Tỷ giá và doanh nghiệp

| Chỉ báo | Cách đọc |
|---|---|
| USD/VND | `vn_forex_ohlcv`; USD/VND tăng là VND yếu. Doanh thu USD quy đổi VND có thể tăng, không tự làm trị giá xuất khẩu USD tăng |
| Chi phí nhập và nợ USD | VND yếu có thể tăng chi phí nhập/nợ và gây lỗ tỷ giá; lợi nhuận phụ thuộc thu/chi ròng, cơ chế giá và phòng hộ |
| Chỉ số USD | Nếu có nguồn thì chỉ dùng bối cảnh; không thay USD/VND và không suy mức cạnh tranh của doanh nghiệp từ chỉ số này |
| Doanh thu xuất khẩu/ngoại tệ | `financial_detail(statement=TM)` nếu có tách, hoặc công bố hãng; thiếu thì không tự suy tỷ trọng |
| Tồn kho/phải thu | BCTC; tăng hơn doanh thu cần xét tuổi nợ/tồn kho và mùa vụ, không tự chứng minh đơn hàng đang ùn |

`peer_compare` chỉ dùng key tổng quan thực trả; KPI thị trường xuất khẩu, nguyên
liệu nhập, công suất lấy từ BCTC/công bố từng peer cùng kỳ, cùng phân khúc.
