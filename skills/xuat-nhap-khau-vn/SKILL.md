---
name: xuat-nhap-khau-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích xuất nhập khẩu Việt Nam theo thuế theo xuất xứ/hàng/đích/ngày, cơ cấu ngành hàng, động lực FDI và dòng nhập khẩu làm tín hiệu dẫn. Dùng khi hỏi ngành xuất khẩu và tác động thương mại."
activation: auto
requires_tools: [vs_xnk_detail, vs_indicator_data]
uses_tools: [vs_xnk_detail, vs_indicator_data, financial_detail, financial_ratios, vn_forex_ohlcv, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành xuất nhập khẩu, tác động thuế quan đến xuất khẩu, thuế xuất khẩu, thuế nhập khẩu, cán cân thương mại, vốn FDI, nhập siêu, tỷ giá xuất khẩu, phân tích xuất khẩu, xuất khẩu tăng, nhập khẩu máy móc]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Xuất nhập khẩu Việt Nam — framework phân tích

Xuất nhập khẩu VN là **chu kỳ chính sách trên nền chu kỳ công nghệ**: tăng trưởng
hàng năm là một con số, nhưng bên trong nó các ngành hàng chạy theo chu kỳ khác
nhau (điện tử đang tăng mạnh trong khi dệt may đi ngang). Skill này đọc ngành bằng:

1. **Thuế theo phạm vi thực áp** — mức thuế có thể khác theo xuất xứ, mã/nhóm
   hàng, thị trường đích và ngày hiệu lực. Thuế cơ sở/đối ứng, chống bán phá giá,
   chống trợ cấp, biện pháp ngành và miễn trừ có thể tương tác; kiểm tra quy tắc
   cộng dồn trong văn bản, không giả định đồng mức cho mọi đối tác.
2. **Chu kỳ công nghệ toàn cầu** — điện tử và linh kiện có chu kỳ riêng, không đi
   cùng dệt may.
3. **Nhập khẩu máy móc như chỉ báo dẫn** — nhập thiết bị có thể báo hiệu đầu tư, nhưng cần dự án, tiến độ và công suất
   công bố để xác minh; có thể chỉ thay thế máy, nhập tồn kho hoặc tái xuất.
4. **Dòng vốn nước ngoài** — doanh nghiệp vốn ngoại chiếm phần lớn trị giá xuất
   khẩu; thu hút đầu tư mới là tín hiệu dẫn cho chu kỳ xuất khẩu tiếp theo.

## Khi nào dùng

- Dùng khi: user hỏi xuất khẩu, nhập khẩu, thuế quan ảnh hưởng gì, dòng vốn FDI, ngành nào đang hưởng và ngành nào bị siết.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`; chỉ đọc BCTC một mã → `co-ban-chuyen-sau`.
  - Xuất khẩu nông sản/lâm sản (gạo, cà phê, hạt điều, gỗ) đọc tại đây — kênh xuất
    khẩu và nhóm hàng; phần vĩ mô sản xuất nội địa → `danh-gia-vi-mo-viet-nam`.
  - Số liệu vĩ mô VN chi tiết (tăng trưởng GDP, lạm phát) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Thuế theo phạm vi | Chênh thuế thực áp theo nước xuất xứ, nhóm hàng và thị trường có thể đổi giá tương đối; miễn trừ và thời điểm hiệu lực phải được kiểm tra | Văn bản cơ quan thương mại/hải quan thị trường đích; `news_market`/`web_search` để tìm nguồn chính thức, ghi mã hàng, ngày hiệu lực và quy tắc cộng dồn |
| Chu kỳ công nghệ toàn cầu | Chu kỳ thay thế/tăng công suất điện tử điều khiển cả tăng trưởng toàn ngành, tách khỏi dệt may và hàng thủ công | Tăng trưởng **theo nhóm hàng**: `news_market`/`web_search` (công bố GSO và Tổng cục Hải quan theo kỳ, ghi rõ nguồn) — `vs_xnk_detail` chỉ trả cơ cấu theo nước, không có nhóm hàng |
| Nhập khẩu máy móc (chỉ báo dẫn) | Nhập thiết bị/linh kiện có thể báo hiệu đầu tư hoặc tích trữ; cần công bố dự án, tiến độ và đơn hàng để xác nhận, không chứng minh công suất mới chỉ từ chuỗi nhập | Nhập **thiết bị/máy móc theo nhóm hàng**: `news_market`/`web_search` (bảng hàng hoá theo kỳ, ghi nguồn + kỳ); đối chiếu thêm `vs_xnk_detail` cho hướng nhập theo nước |
| Dòng vốn nước ngoài | Doanh nghiệp vốn ngoài chiếm phần lớn trị giá xuất khẩu; đăng ký mới và giải ngân quyết định sản lượng tương lai | Vốn đăng ký/giải ngân: tra chỉ tiêu được hỗ trợ trước khi dùng `vs_indicator_data`, hoặc lấy công bố cơ quan quản lý đầu tư; ghi kỳ và phân biệt đăng ký/giải ngân |
| Cơ cấu ngành hàng | Cùng nhãn "xuất khẩu", nhưng điện tử, dệt may, hàng thủ công, lâm sản và thủy sản chịu thuế khác nhau và theo chu kỳ khác nhau | Nhóm hàng + trị giá: `news_market`/`web_search` (thống kê hàng hoá theo kỳ). `vs_xnk_detail` chỉ cho **cơ cấu theo nước + tỷ trọng khu vực FDI** |
| Tỷ giá | USD/VND tăng có thể tăng doanh thu USD quy đổi VND, đồng thời tăng chi phí nhập khẩu/nợ USD. Không tự làm trị giá xuất khẩu bằng USD tăng; tác động lợi nhuận tùy thu/chi ngoại tệ ròng và phòng hộ | `vn_forex_ohlcv` cho USD/VND, đối chiếu thuyết minh doanh nghiệp; chỉ số USD là bối cảnh và không thay tỷ giá song phương |

## Các bước

**Bước 1: Xác định phạm vi (song song).**

`symbol_lookup` (nếu hỏi về một công ty) · `vn_company` (mảng sản phẩm + thị trường
xuất khẩu). Nếu hỏi ngành → đọc thẳng Bước 2.

**Bước 2: Số liệu thương mại (song song).**

`vs_xnk_detail` (xuất/nhập khẩu theo kỳ, **theo nước** + tỷ trọng FDI) · `vs_indicator_data`
(tổng mức XK qua preset `XK`; với FDI, tra danh mục chỉ tiêu và tham số hỗ trợ trước, hoặc lấy công bố cơ quan quản lý đầu tư) · `news_market`/`web_search` cho chuỗi
**theo nhóm hàng** (thiết bị, điện tử, dệt may, thủy sản) — ghi rõ kỳ và nhóm hàng đang đọc.

**Bước 3: Chính sách thuế + tỷ giá (song song).**

`news_market` (chính sách thuế, danh sách miễn, biện pháp kỹ thuật, điều tra) ·
`vn_forex_ohlcv` (USD/VND); chỉ số USD từ nguồn công bố nếu cần bối cảnh.

**Bước 4: Đọc chéo cặp nhập – xuất (song song).**

Đặt nhập khẩu thiết bị/linh kiện cạnh xuất khẩu **cùng nhóm hàng** (cả hai lấy từ
`news_market`/`web_search` theo kỳ; `vs_xnk_detail` chỉ đối chiếu hướng theo nước) ·
tương quan chính sách (`news_market`) · riêng mã: `financial_detail` (doanh thu xuất khẩu nếu công bố) · `peer_compare` chỉ key tổng quan thực trả; cơ cấu xuất khẩu và KPI vận hành lấy BCTC/công bố từng peer cùng kỳ.

## Cây quyết định ngành hàng đang hưởng hay bị siết

Duyệt các node theo thứ tự; ghi trạng thái trung gian rồi đi tiếp. Chỉ dừng ở ★.
Thiếu dữ liệu phải ghi rõ và hạ độ tin cậy; không coi thiếu là tín hiệu xấu.

Q1. Đã xác định thuế theo xuất xứ, mã/nhóm hàng, thị trường đích, miễn trừ và ngày hiệu lực chưa?
├─ Có → ghi mức thực áp và phạm vi → Q2
└─ Chưa → ghi chưa xác minh thuế; không giả định miễn hoặc đồng mức → Q2

Q2. Mức thực áp có cao hơn đối thủ cùng sản phẩm/thị trường không?
├─ Cao hơn → ghi bất lợi giá tương đối → Q3
├─ Bằng/thấp hơn → ghi trung tính/lợi thế tương đối → Q3
└─ Thiếu dữ liệu đối thủ → ghi chưa rõ lợi thế thuế → Q3

Q3. Đơn hàng, giá và sản lượng nhóm hàng đang thế nào?
├─ Cùng cải thiện → ghi cầu thuận → Q4
├─ Suy yếu → ghi áp lực cầu → Q4
└─ Thiếu/trái chiều → ghi chưa rõ cầu, không suy từ nhãn công nghệ/dệt may → Q4

Q4. Nhập thiết bị/linh kiện tăng có gắn dự án cụ thể không?
├─ Có công bố tiến độ, công suất và đơn hàng → ghi tín hiệu đầu tư có đối chiếu → Q5
├─ Chỉ thấy nhập tăng → ghi tín hiệu cần xác minh, có thể là thay thế/tồn kho → Q5
├─ Nhập không tăng → ghi chưa có tín hiệu từ nhập; không suy không có công suất mới → Q5
└─ Thiếu chuỗi theo nhóm hàng → ghi chưa có chỉ báo dẫn → Q5

Q5. Rủi ro tỷ giá ròng của doanh nghiệp là gì?
├─ VND yếu, thu USD ròng sau nhập khẩu/nợ/phòng hộ → ★ "Có thể tăng doanh thu quy đổi VND; đánh giá cùng thuế, cầu và tín hiệu đầu tư đã ghi"
├─ VND yếu, chi USD ròng hoặc nợ USD lớn → ★ "Có thể tăng chi phí nhập/nợ và lỗ tỷ giá; doanh thu USD không tự tăng do tỷ giá"
├─ VND mạnh → ★ "Doanh thu USD quy đổi VND có thể giảm, chi phí nhập/nợ USD có thể giảm; kết luận theo vị thế ròng và phòng hộ"
├─ Ổn định → ★ "Tỷ giá ít biến động; đánh giá chủ yếu từ thuế, cầu và đầu tư đã ghi"
└─ Thiếu cơ cấu ngoại tệ hoặc dữ liệu tỷ giá → ★ "Chưa đủ dữ liệu kết luận tác động tỷ giá; giới hạn kết luận ở các kênh đã xác minh"

## Chỉ báo đặc thù ngành

Bảng chỉ báo XNK + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Xuất nhập khẩu không định giá bằng hệ số chung: dùng **khung theo nhóm hàng** — hàng công
nghệ theo P/E kỳ vọng chu kỳ thay thế, hàng thủ công theo EV/EBITDA theo mùa và
chi phí đầu vào, hàng nông sản theo P/E kỳ vọng giá đầu ra. Luôn ước lượng **tỷ
trọng thuế được miễn trong trị giá xuất khẩu** trước khi chốt kỳ vọng tăng trưởng.
Neo kỳ vọng bằng `planned_targets` và `analyst_consensus`.

## Rủi ro đặc thù

- **Rủi ro thuế chủ đề**: danh sách miễn thay đổi theo vòng chính sách; ngành không
  miễn mất lợi thế giá so với đối thủ được miễn.
- **Rủi ro đơn hàng**: nông sản/thủy sản nhỏ lẻ dễ chịu đơn hàng hủy và điều tra.
- **Rủi ro chu kỳ công nghệ**: điện tử nhảy mạnh khi tăng trưởng, nhưng cũng rơi mạnh
  khi chu kỳ thay thế chững.
- **Rủi ro tỷ giá**: chi phí nguyên liệu nhập khẩu và trị giá xuất khẩu đi ngược
  chiều trên cùng một bảng cân đối.
- **Rủi ro đọc sai tổng số**: tăng trưởng toàn ngành là một con số che nhiều chu kỳ
  ngành hàng đi ngược chiều.

## Ranh giới

- Không xác định pha thị trường, không suy "xuất khẩu mạnh nên ngành X sẽ dẫn sóng" →
  `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy mức thuế từ trí nhớ khi chưa tra: thuế là biến số chính sách, phải ghi
  rõ nguồn và ngày văn bản.
- Không trộn tổng số thương mại với kỳ vọng ngành hàng cụ thể.

## Giới hạn

- `vs_xnk_detail` cập nhật theo tháng qua phiên trình duyệt, có độ trễ: ghi rõ kỳ dữ
  liệu.
- Tỷ trọng xuất khẩu/khu vực FDI là tổng số quốc gia, không phải tỷ trọng của một
  công ty riêng.
- Danh sách miễn và mức thuế là chính sách đang thay đổi: kết luận phải ghi ngày văn
  bản đang áp dụng.

## Ví dụ

**Ví dụ 1:**
Hỏi: Xuất khẩu tăng mạnh thì nhóm nào hưởng?
Đạt khi: phân biệt được tổng số với nhóm hàng, có nhập khẩu máy móc cùng nhóm làm chỉ
báo dẫn, và verdict theo cây Q1→Q5 ghi rõ nhóm hàng nào.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
stacked trị giá xuất khẩu theo nhóm hàng, multiline nhập thiết bị với xuất hàng công
nghệ, bar tỷ trọng thuế miễn ước lượng. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc cặp nhập – xuất làm chỉ báo dẫn, phân nhóm hàng và cách ước lượng tỷ trọng thuế miễn |
