---
name: tieu-dung-ban-le-vn
description: "Đọc ngành tiêu dùng – bán lẻ VN: bán lẻ thực (bỏ lạm phát), thu nhập hộ gia đình, cửa hàng hiện hữu so với mở mới, biên, chi phí đầu vào. Dùng khi hỏi sức mua hay chuỗi bán lẻ, hàng tiêu dùng."
activation: auto
requires_tools: [financial_detail, vs_indicator_data]
uses_tools: [financial_detail, financial_statements, vs_indicator_data, vs_categories, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành tiêu dùng, nhóm tiêu dùng, ngành bán lẻ, nhóm bán lẻ, chuỗi bán lẻ, cổ phiếu bán lẻ, hàng tiêu dùng, bán lẻ hiện đại, sức mua, tổng mức bán lẻ, cửa hàng hiện hữu]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Tiêu dùng & bán lẻ Việt Nam — framework phân tích

Doanh thu tiêu dùng danh nghĩa gồm cả lạm phát; sức mua thật là **tăng trưởng thực**
(bỏ lạm phát) và **thu nhập hộ gia đình**. Với chuỗi bán lẻ, tăng trưởng gồm hai phần
khác nhau: **mở cửa hàng mới** và **tăng trưởng cùng cửa hàng** (cửa hàng hiện hữu
bán nhiều hơn) — chỉ phần sau cho thấy thị phần thật. Ngành gồm nhiều phân khúc có
driver riêng: hàng thiết yếu (bách hoá, thực phẩm), điện máy – điện thoại (chu kỳ thay
thiết bị), trang sức (giá vàng), nhà thuốc, và nhà sản xuất hàng tiêu dùng (chi phí
nguyên liệu, sản lượng).

## Khi nào dùng

- Dùng khi: hỏi sức mua đang thế nào, nhóm tiêu dùng – bán lẻ được tiếp sức hay bị
  siết, một chuỗi bán lẻ còn tăng trưởng không, nên đọc bán lẻ thực hay danh nghĩa.
- Khi KHÔNG dùng:
  - Pha thị trường, tiêu dùng có phải nơi trú ẩn không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - GDP, CPI, vĩ mô tổng thể → `danh-gia-vi-mo-viet-nam`.
  - Xuất khẩu thực phẩm, nông sản → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Bán lẻ thực | Tổng mức bán lẻ danh nghĩa trừ lạm phát mới là thể tích; danh nghĩa tăng đẹp có thể chỉ là giá | Tổng mức bán lẻ: `vs_categories` → `vs_indicator_data(category_id=…, term_type_id=…)`; CPI: `vs_indicator_data(indicator="CPI")` |
| Thu nhập hộ gia đình | Thu nhập, việc làm quyết định sức mua; tăng chậm thì người mua chuyển sang hàng rẻ hơn | Catalogue chỉ tiêu (`vs_categories`) nếu có chuỗi thu nhập; không có thì `web_search` (số thống kê theo kỳ) |
| Chính sách | Giảm thuế GTGT, điều chỉnh lương, hoá đơn điện tử với hộ kinh doanh (thu hẹp lợi thế giá của kênh truyền thống) | `web_search`, ghi văn bản + ngày hiệu lực |
| Cùng cửa hàng và mở mới | Mở mới nhanh mà cùng cửa hàng âm = tăng trưởng mua bằng mở rộng, dễ đảo chiều khi ngừng mở | Số cửa hàng, doanh thu/cửa hàng: công bố công ty (`news_symbol`); tự tính khi đủ số, ghi rõ |
| Chi phí đầu vào | Nhà sản xuất chịu giá nguyên liệu (sữa bột, đường, lúa mạch, bao bì); trang sức chịu giá vàng | Giá vốn (KQKD); giá nguyên liệu: `web_search` |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo chuỗi/mảng). Xác định **phân khúc lớn nhất**.

**Bước 2 (song song):** `vs_categories` (tìm category tổng mức bán lẻ, thu nhập) rồi
`vs_indicator_data(category_id=…, term_type_id=…)` — cặp category/term_type phải khớp
metadata, sai thì trả rỗng · `vs_indicator_data(indicator="CPI")` · `web_search` (chính
sách thuế, lương).

**Bước 3 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
chi phí bán hàng) · `financial_detail(symbol, statement=CDKT)` (tồn kho, phải trả người
bán) · `news_symbol(symbol)` (số cửa hàng, doanh thu tháng, mở/đóng cửa hàng).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với chuỗi cùng phân khúc: chỉ
báo vận hành đọc bằng `financial_detail` từng mã (tối đa 3); số cửa hàng từ công bố
công ty; `peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định doanh nghiệp tiêu dùng – bán lẻ đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Tăng trưởng đến từ đâu?
├─ Chủ yếu mở cửa hàng mới, cùng cửa hàng đi ngang hoặc âm → ★ "Tăng trưởng mua bằng
│  mở rộng: dễ chững khi tốc độ mở chậm lại, đọc chi phí mở mới và biên"
├─ Cùng cửa hàng tăng, hoặc là nhà sản xuất (không có cửa hàng) → tiếp Q2
└─ Không tách được → tiếp Q2, ghi rõ

Q2. Bán lẻ thực (bỏ lạm phát) còn dương không?
├─ Danh nghĩa dương nhưng thực âm → ★ "Tăng trưởng của thị trường đến từ giá, không
│  từ thể tích: hạ kỳ vọng sản lượng"
├─ Thực dương → tiếp Q3
└─ Không lấy được số → tiếp Q3, ghi "chưa đọc được bán lẻ thực"

Q3. Thu nhập và chính sách có đỡ sức mua không?
├─ Thu nhập tăng chậm, không có chính sách hỗ trợ → ★ "Bị siết bởi thu nhập: người mua
│  chuyển sang hàng rẻ, chuỗi giá cao chịu trước"
└─ Thu nhập cải thiện hoặc có chính sách hỗ trợ, hoặc không có số → tiếp Q4

Q4. Biên lãi gộp có giữ được không?
├─ Giữ hoặc mở rộng cùng tăng trưởng → ★ "Được tiếp sức: thể tích tăng và biên giữ
│  được là cấu trúc tốt nhất của ngành"
├─ Giảm vì khuyến mại hoặc chi phí đầu vào → ★ "Tăng trưởng mua bằng giá hoặc bị chi
│  phí ép: đọc tồn kho và chi phí bán hàng"
└─ Một quý biến động chưa đủ → ★ "Biên chưa rõ xu hướng: cần thêm một quý, độ tin
   cậy trung bình"

## Chỉ báo đặc thù ngành

Công thức bán lẻ thực, cùng cửa hàng và cách đọc theo phân khúc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Doanh nghiệp có lợi nhuận ổn định: **P/E** so với tăng trưởng lợi nhuận. Chuỗi đang mở
rộng chưa có lãi: **EV/doanh thu** kèm doanh thu/cửa hàng, ghi rõ giai đoạn. Một kỳ biên
giảm có thể là khuyến mại có chủ đích — đọc 2 quý liền.

## Rủi ro đặc thù

- Đọc số danh nghĩa thay thực: thấy "tăng trưởng tốt" khi thể tích tăng ít.
- Thu nhập tăng chậm làm người mua chuyển sang hàng rẻ.
- Khuyến mại kéo dài để giữ thị phần ăn vào biên.
- Giá nguyên liệu (sữa, đường, vàng) tăng khi giá bán chưa theo.
- Nhầm phân khúc: điện máy, trang sức, thực phẩm theo chu kỳ khác nhau.

## Ranh giới

- Không xác định pha thị trường, không nói "tiêu dùng là nơi trú ẩn" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không dùng số danh nghĩa thay số thực trong kết luận.
- Không nêu thuế suất, mức lương, thời hạn chính sách từ trí nhớ: tra văn bản, ghi số
  hiệu + ngày (luật này chỉ nằm ở đây).

## Giới hạn

- Số thống kê theo tháng có độ trễ — ghi kỳ.
- Cùng cửa hàng không phải công ty nào cũng công bố — ghi rõ khi thiếu.

## Ví dụ

Hỏi: Chuỗi bán lẻ còn tăng trưởng được nữa không?
Đạt khi: tách mở mới và cùng cửa hàng (hoặc ghi thiếu), có bán lẻ thực tự tính kèm kỳ,
biên 2 quý, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường bán lẻ danh nghĩa và thực,
cột biên lãi gộp theo quý, cột số cửa hàng và doanh thu/cửa hàng. Vẽ bằng `chart_render`
với `from_call` (mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp
`ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần công thức bán lẻ thực, cùng cửa hàng, dòng BCTC theo statement và cách đọc theo phân khúc |
