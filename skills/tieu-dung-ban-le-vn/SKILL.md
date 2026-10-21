---
name: tieu-dung-ban-le-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành tiêu dùng và bán lẻ Việt Nam theo bán lẻ thực, thu nhập hộ gia đình, chính sách thuế và độ thâm nhập bán lẻ hiện đại. Dùng khi hỏi xu hướng nhóm tiêu dùng hoặc kết quả chuỗi bán lẻ."
activation: auto
requires_tools: [financial_detail, vs_indicator_data]
uses_tools: [financial_detail, vs_indicator_data, vs_categories, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, company_events, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành tiêu dùng, chuỗi bán lẻ, hàng tiêu dùng, bán lẻ hiện đại, thu nhập hộ gia đình, sức mua, thị phần bán lẻ, mảng tiêu dùng]
version: 1.0.0
---

# Tiêu dùng & bán lẻ Việt Nam — framework phân tích

Ngành này không đọc bằng doanh thu danh nghĩa: số liệu bán lẻ danh nghĩa gồm cả
lạm phát, còn sức mua thật nằm ở **tăng trưởng thực (bỏ lạm phát)** và **thu nhập
hộ gia đình**. Skill này đọc ngành qua bán lẻ thực, thu nhập (rào cản cầu), chính
sách hỗ trợ sức mua, và **độ thâm nhập bán lẻ hiện đại** — động cơ dài hạn của
ngành và là thứ phân biệt chuỗi hiện đại với chợ truyền thống.

Lưu ý phân loại: **bán lẻ điện tử tiêu dùng** (máy tính, điện thoại, thiết bị) là
chu kỳ thay thế thiết bị, khác chu kỳ thực phẩm – hàng thiết yếu. Cả hai cùng nằm
trong nhãn "bán lẻ" nhưng driver không dùng chung.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm tiêu dùng/bán lẻ, một chuỗi bán lẻ có còn tăng
  trưởng mở rộng không, sức mua đang thế nào.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết → `danh-gia-vi-mo-viet-nam`.
  - Xuất khẩu thực phẩm/nông sản → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Bán lẻ thực | Chênh lệch bán lẻ danh nghĩa và thực là lạm phát. Đọc số danh nghĩa sẽ thấy "tăng trưởng tốt" trong khi thể tích tăng ít | `vs_indicator_data` (tổng mức bán lẻ + chỉ số giá) — đọc cả hai rồi mới kết luận thực |
| Thu nhập hộ gia đình | Thu nhập là rào cản cầu. Tạo việc làm chậm + tiền lương công vụ đóng băng làm thu nhập tăng chậm, kéo sức mua | `vs_indicator_data` (thu nhập/tiền lương nếu có) + `news_market` (chính sách thu nhập). Thiếu → ghi rõ |
| Chính sách hỗ trợ sức mua | Giảm thuế giá trị gia tăng hàng thiết yếu hỗ trợ sức mua trong thời hạn nhất định; chính sách "chính thức hoá thị trường" (hoá đơn, niêm yết) làm giảm lợi thế giá của kênh truyền thống | `news_market` (văn bản + hiệu lực), ghi rõ nguồn + ngày |
| Độ thâm nhập bán lẻ hiện đại | Bán lẻ hiện đại chiếm tỷ trọng thấp so với khu vực → mở chuỗi là động cơ tăng trưởng dài hạn. Chuỗi mở cửa vượt tốc độ thị trường thì tăng thị phần | Diễn biến chuỗi (số cửa, diện tích) + thị phần: `news_symbol`/`company_events` hoặc `web_search` nguồn doanh nghiệp |
| Doanh thu cùng cửa hàng | Mở cửa hàng mới và tăng trưởng cùng cửa hàng là hai tăng trưởng khác nhau. Cùng cửa tăng nghĩa là thị phần đang ăn vào đối thủ | `financial_detail` + công bố công ty qua `news_symbol`/`company_events`; tự tính nếu công bố cho phép, ghi rõ |
| Phân khúc | Hàng thực phẩm thiết yếu (chu kỳ ổn) khác điện tử tiêu dùng (chu kỳ thay thế thiết bị). Không dùng chung một driver | Mảng trong `financial_detail` + `vn_company` |

## Các bước

**Bước 1: Nhận diện phân khúc (song song).**

`symbol_lookup` · `vn_company` (mảng: thực phẩm/điện tử/dịch vụ) · `financial_detail`
(doanh thu theo mảng). Ghi rõ phân khúc đang phân tích.

**Bước 2: Sức mua thật (song song — tra catalogue TRƯỚC).**

`vs_indicator_data` chỉ có preset sẵn cho GDP/CPI/XK; các chuỗi khác (tổng mức bán
lẻ, CPI lõi, thu nhập) phải lấy `category_id` từ `vs_categories` trước, rồi truyền
kèm `term_type_id` phù hợp. Gọi `vs_categories` → chọn category + term_type →
`vs_indicator_data(category_id=…, term_type_id=…)`; preset `CPI` dùng trực tiếp
`vs_indicator_data(indicator="CPI")`. Kèm `news_market` (chính sách thuế, thu nhập,
tiền lương công vụ).

**Bước 3: Chất lượng tăng trưởng (song song).**

`financial_detail` (doanh thu, biên lãi gộp, tồn kho, công nợ; số điểm bán nếu
công bố) · `news_symbol`/`company_events` hoặc `web_search` nguồn doanh nghiệp (mở/đóng cửa, thị phần); `news_market` chỉ dùng cho bối cảnh chung.

**Bước 4: Neo kỳ vọng + vị thế nhóm (song song).**

`planned_targets` · `analyst_consensus` · hai mảng đối chiếu khác nhau: (a) tỷ lệ
định giá (P/E, P/B, ROE) dùng `peer_compare`; (b) chỉ báo vận hành (biên lãi gộp,
tồn kho, công nợ) đọc bằng `financial_detail` **từng peer**, số điểm bán/tốc độ mở
rộng lấy từ công bố công ty qua `news_symbol`/`company_events` — `peer_compare` không trả được
những dòng này.

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định chuỗi bán lẻ đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Tăng trưởng đến từ đâu?
├─ Cùng cửa hàng tăng → ghi thuận lợi, tiếp Q2
├─ Chủ yếu mở mới, cùng cửa chững → ghi phụ thuộc mở rộng, tiếp Q2
└─ Chưa phân tách được → ghi thiếu, tiếp Q2

Q2. Bán lẻ thực còn tăng không?
├─ Tăng sau điều chỉnh chỉ số giá phù hợp, cùng kỳ → ghi thuận lợi, tiếp Q3
├─ Giảm, dù danh nghĩa tăng → ghi áp lực sức mua, tiếp Q3
└─ Chưa có chỉ số giá/tổng bán lẻ so sánh được → ghi thiếu, tiếp Q3

Q3. Thu nhập có hỗ trợ sức mua không?
├─ Thu nhập thực cải thiện hoặc chính sách đã có hiệu lực → ghi thuận lợi, tiếp Q4
├─ Thu nhập thực giảm theo nguồn xác minh → ghi áp lực, tiếp Q4
└─ Chưa có dữ liệu → ghi thiếu, tiếp Q4

Q4. Chính sách ảnh hưởng phân khúc và chuỗi thế nào?
├─ Có hỗ trợ đã xác minh đối tượng/hiệu lực → ghi tác động cụ thể, tiếp Q5
├─ Không có ưu đãi riêng hoặc cạnh tranh tăng → ghi trạng thái trung tính/rủi ro, tiếp Q5
└─ Chưa rõ → ghi thiếu, tiếp Q5

Q5. Biên, tồn kho và công nợ xác nhận điều gì?
├─ Tăng trưởng thực/cùng cửa và biên giữ được, tồn kho/công nợ phù hợp → ★ "Được tiếp sức bởi vận hành và sức mua đã xác minh"
├─ Biên giảm do khuyến mại hoặc tồn kho/công nợ tăng bất lợi → ★ "Tăng trưởng có chi phí; nêu yếu tố gây áp lực đã xác minh"
└─ Dữ liệu thiếu hoặc trái chiều → ★ "Chưa đủ dữ liệu kết luận tổng thể; thiếu thu nhập/chính sách không tự thành nhận định xấu"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành tiêu dùng/bán lẻ + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Tiêu dùng/bán lẻ định giá bằng **P/E** (ngành có lợi nhuận ổn định) và **EV/
chỉ số vốn hoá theo doanh thu** cho giai đoạn mở rộng chưa có lãi. Đọc kèm quy mô
doanh thu cùng cửa để tránh nhầm "mở rộng" với "tăng trưởng thật". Neo kỳ vọng
bằng `planned_targets` và `analyst_consensus`. Giai đoạn khuyến mại: một kỳ biên
giảm có thể là cố ý, đọc 2 quý liền.

## Rủi ro đặc thù

- **Rủi ro đọc sai danh nghĩa**: báo cáo "bán lẻ tăng trưởng tốt" trong khi thể
  tích tăng ít.
- **Rủi ro thu nhập đứng**: rào cản cầu không phá được trong ngắn hạn.
- **Rủi ro biên bằng khuyến mại**: tăng trưởng mua bằng giá, biến đổi khi đối thủ
  theo sau.
- **Rủi ro chi phí đầu vào**: giá nguyên liệu thực phẩm và chi phí vận hành chuỗi
  áp biên.
- **Rủi ro nhầm phân khúc**: chu kỳ điện tử tiêu dùng khác chu kỳ thực phẩm.

## Ranh giới

- Không xác định pha thị trường, không suy "tiêu dùng là nơi trú ẩn" theo chu kỳ →
  `dinh-vi-chu-ky-vn` (nơi giữ vai trò các mảng theo pha).
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không dùng số danh nghĩa thay tăng trưởng thực trong kết luận.
- Không suy chính sách thuế từ trí nhớ: tra văn bản hiện hành, ghi nguồn + ngày.

## Giới hạn

- Chỉ số giá tiêu dùng và lõi cập nhật theo tháng, độ trễ — ghi rõ kỳ đang dùng.
- Doanh thu cùng cửa không phải kỳ nào công ty cũng công bố: khi thiếu, hạ độ tin
  cậy nhánh Q1.
- Bán lẻ hiện đại thâm nhập là con số ước tính ngành, ghi rõ nguồn.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chuỗi bán lẻ này còn tăng trưởng được nữa không?
Đạt khi: phân biệt được tăng trưởng mở cửa với cùng cửa, có bán lẻ thực, biên 2 quý,
và verdict theo cây Q1→Q5.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
multiline bán lẻ danh nghĩa vs thực, bar biên lãi gộp theo phân khúc, scatter số
điểm bán với doanh thu cùng cửa. Vẽ bằng `chart_render` với `from_call` (mã
`[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách tính bán lẻ thực, đọc tăng trưởng cùng cửa, và chỉ báo biên/tồn kho theo phân khúc |
