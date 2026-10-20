---
name: xuat-nhap-khau-vn
description: "Phân tích xuất nhập khẩu Việt Nam theo chính sách thuế hai lớp, cơ cấu ngành hàng, động lực đầu tư nước ngoài và dòng nhập khẩu làm tín hiệu dẫn. Dùng khi hỏi xuất khẩu, thuế quan hay chu kỳ xuất khẩu."
activation: auto
requires_tools: [vs_xnk_detail, vs_indicator_data]
uses_tools: [vs_xnk_detail, vs_indicator_data, financial_detail, financial_ratios, yf_commodities, vn_forex_ohlcv, planned_targets, analyst_consensus, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [xuất nhập khẩu, xuất khẩu, nhập khẩu, thuế quan, cán cân thương mại, xuất khẩu hàng hoá, dòng vốn nước ngoài, thuế quan mỹ, nhập siêu, tỷ giá xuất khẩu]
version: 1.0.0
---

# Xuất nhập khẩu Việt Nam — framework phân tích

Xuất nhập khẩu VN là **chu kỳ chính sách trên nền chu kỳ công nghệ**: tăng trưởng
hàng năm là một con số, nhưng bên trong nó các ngành hàng chạy theo chu kỳ khác
nhau (điện tử đang tăng mạnh trong khi dệt may đi ngang). Skill này đọc ngành bằng:

1. **Thuế hai lớp** — thuế đối ứng chung (mức đều cho mọi đối tác) và **thuế chủ
   đề chọn lọc** (ví dụ biện pháp kỹ thuật lao động): lớp thứ hai có **danh sách
   miễn** và các ngành không được miễn chịu chênh lệch rõ rệt so với đối thủ.
2. **Chu kỳ công nghệ toàn cầu** — điện tử và linh kiện có chu kỳ riêng, không đi
   cùng dệt may.
3. **Nhập khẩu máy móc như chỉ báo dẫn** — nhập thiết bị tăng trước khi xuất khẩu
   tăng, vì tiến độ triển khai công suất chưa cho ra sản phẩm.
4. **Dòng vốn nước ngoài** — doanh nghiệp vốn ngoại chiếm phần lớn trị giá xuất
   khẩu; thu hút đầu tư mới là tín hiệu dẫn cho chu kỳ xuất khẩu tiếp theo.

## Khi nào dùng

- Dùng khi: user hỏi xuất khẩu, nhập khẩu, thuế quan ảnh hưởng gì, dòng vốn nước
  ngoài, ngành nào đang hưởng và ngành nào bị siết.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Ngành xuất khẩu hàng nông sản/lâm thổ sản (gạo, cà phê, gỗ) → `tieu-dung-ban-le-vn`
    cho phần sản xuất; kênh xuất khẩu đọc ở đây.
  - Số liệu vĩ mô VN chi tiết (tăng trưởng GDP, lạm phát) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Thuế hai lớp | Thuế đối ứng chung đều cho mọi đối thủ, nên **không đổi thứ hạng cạnh tranh**. Thuế chủ đề chọn lọc làm chênh: ngành không được miễn mất lợi thế giá so với quốc gia bị áp mức thấp hơn | Chính sách thuế + danh sách miễn + mức áp từng nước: `news_market`/`web_search` (cơ quan thương mại và báo chí chuyên ngành), ghi rõ nguồn + ngày |
| Chu kỳ công nghệ toàn cầu | Chu kỳ thay thế/tăng công suất điện tử điều khiển cả tăng trưởng toàn ngành, tách khỏi dệt may và hàng thủ công | Tăng trưởng theo nhóm hàng: `vs_xnk_detail` (xuất khẩu theo kỳ) + `news_market` |
| Nhập khẩu máy móc (chỉ báo dẫn) | Nhập thiết bị công nghệ tăng trước vài quý so với xuất khẩu hàng công nghệ: dây chuyền chưa chạy thì hàng chưa chảy về | `vs_xnk_detail` (nhập khẩu theo kỳ), đọc cặp nhập – xuất cùng nhóm hàng |
| Dòng vốn nước ngoài | Doanh nghiệp vốn ngoài chiếm phần lớn trị giá xuất khẩu; đăng ký mới và giải ngân quyết định sản lượng tương lai | Vốn đăng ký/giải ngân: `vs_indicator_data` hoặc `news_market`, ghi kỳ |
| Cơ cấu ngành hàng | Cùng nhãn "xuất khẩu", nhưng điện tử, dệt may, hàng thủ công, lâm thổ sản và thủy sản chịu thuế khác nhau và theo chu kỳ khác nhau | Nhóm hàng + trị giá: `vs_xnk_detail` |
| Tỷ giá | Tỷ giá vàng (USD) tác động giá trị xuất khẩu tính theo ngoại tệ và chi phí nhập khẩu tính bằng nội tệ | `vn_forex_ohlcv` (USD/VND theo chu kỳ) + `yf_commodities` (chỉ số USD) |

## Các bước

**Bước 1: Xác định phạm vi (song song).**

`symbol_lookup` (nếu hỏi về một công ty) · `vn_company` (mảng sản phẩm + thị trường
xuất khẩu). Nếu hỏi ngành → đọc thẳng Bước 2.

**Bước 2: Số liệu thương mại (song song).**

`vs_xnk_detail` (xuất/nhập khẩu theo kỳ, theo nhóm hàng) · `vs_indicator_data`
(tổng mức thương mại, dòng vốn nước ngoài). Ghi rõ kỳ và nhóm hàng đang đọc.

**Bước 3: Chính sách thuế + tỷ giá (song song).**

`news_market` (chính sách thuế, danh sách miễn, biện pháp kỹ thuật, điều tra) ·
`vn_forex_ohlcv` + `yf_commodities` (tỷ giá và chỉ báo USD).

**Bước 4: Đọc chéo cặp nhập – xuất (song song).**

Đặt nhập khẩu thiết bị/linh kiện cạnh xuất khẩu cùng nhóm hàng (`vs_xnk_detail`) ·
tương quan chính sách (`news_market`) · riêng mã: `financial_detail` (doanh thu xuất
khẩu nếu công bố) · `peer_compare` nếu so nhiều công ty.

## Cây quyết định ngành hàng đang hưởng hay bị siết

Duyệt Q1→Q6 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Nhóm hàng có nằm trong danh sách miễn của chính sách thuế chọn lọc không?
├─ Có → ★ "Không chịu lớp thuế chủ đề: ranh giới cạnh tranh giữ nguyên — đọc chu kỳ
   công nghệ (Q4) để xem nguồn tăng"
├─ Không → tiếp Q2
└─ Chưa có danh sách rõ → tiếp Q2 với độ tin cậy thấp, ghi rõ

Q2. Nước đang áp mức thuế cao hơn đối thủ cùng phân khúc không?
├─ Có → tiếp Q3
└─ Không hoặc bằng đối thủ → ★ "Ranh giới thuế không siết thêm: đọc chu kỳ công
   nghệ (Q4) và chu kỳ cầu"

Q3. Ngành hàng có đối thủ cùng phân khúc ở mức thuế thấp hơn không?
├─ Có (ví dụ cùng loại hàng xuất khẩu) → ★ "Bị siết bởi thuế chủ đề: đối thủ cùng
   sản phẩm ở mức thuế thấp hơn hưởng chênh lệch — đọc vị thế giá và đơn hàng"
└─ Không, đối thủ đều ở mức trên hoặc bằng → tiếp Q4

Q4. Nhóm hàng đang theo chu kỳ công nghệ tăng hay chu kỳ thủ công đi ngang?
├─ Chu kỳ công nghệ (điện tử, linh kiện, thiết bị) → tiếp Q5
├─ Chu kỳ thủ công/dệt may đi ngang → ★ "Tăng trưởng toàn ngành không phân bổ đều:
   nhóm này đang đi ngang dù tổng xuất khẩu tăng — hạ độ tin cậy kỳ vọng tăng"
└─ Chưa rõ → tiếp Q5 với độ tin cậy thấp

Q5. Nhập khẩu thiết bị cùng nhóm có đang tăng trước không?
├─ Có, nhập tăng vài quý trước → ★ "Được tiếp sức bởi công suất mới: chỉ báo dẫn
   đang tích lũy — xuất khẩu nhóm này sẽ vào sau"
└─ Không, nhập chững → ★ "Không có công suất mới: tăng trưởng đến từ giá/cầu hiện
   có, hạ độ tin cậy khi cầu toàn cầu đổi chiều"

Q6. Tỷ giá đang hỗ trợ hay siết?
├─ Hỗ trợ (nội tệ yếu hỗ trợ trị giá xuất khẩu tính ngoại tệ) → ★ "Tỷ giá thuận:
   giá trị xuất khẩu tính ngoại tệ được đỡ — nhưng đọc chi phí nhập khẩu tính nội tệ"
└─ Siết (nội tệ mạnh/phá giá) → ★ "Tỷ giá nghịch: chi phí nhập nguyên liệu tăng —
   đọc tỷ trọng đầu vào trong giá thành"

## Chỉ báo đặc thù ngành

Bảng chỉ báo xnk + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Xnk không định giá bằng hệ số chung: dùng **khung theo nhóm hàng** — hàng công
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
báo dẫn, và verdict theo cây Q1→Q6 ghi rõ nhóm hàng nào.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
stacked trị giá xuất khẩu theo nhóm hàng, multiline nhập thiết bị với xuất hàng công
nghệ, bar tỷ trọng thuế miễn ước lượng. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc cặp nhập – xuất làm chỉ báo dẫn, phân nhóm hàng và cách estimators tỷ trọng thuế miễn |
