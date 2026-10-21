---
name: thep-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành thép VN theo spread nguyên liệu–thành phẩm, phòng vệ thương mại, cơ cấu sản phẩm và biên lãi gộp. Dùng khi hỏi xu hướng nhóm thép, đọc kết quả nhà máy thép, lãi gộp hay chi phí đầu vào."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành thép, thép xây dựng, thép cuộn, nhà máy thép, sản xuất thép, biên lợi nhuận thép, thép nhập khẩu, sản lượng thép, lãi gộp thép, chi phí đầu vào thép]
version: 1.0.0
---

# Thép Việt Nam — framework phân tích

Lợi nhuận ngành thép đến từ **spread giá thành phẩm trừ chi phí nguyên liệu**, nên
skill này đọc ngành bằng bốn biến: giá bán, chi phí đầu vào (quặng sắt và than cốc),
khối lượng thật bán được, và **rào phòng vệ thương mại** — thứ quyết định giá bán
trong nước có giữ được hay mất vào nhập khẩu. Đọc riêng giá thành phẩm mà không
đọc cặp giá đầu vào sẽ cho kết luận ngược: đã có kỳ bán nhiều hơn, giá giảm và
nguyên liệu tăng cùng lúc khiến lãi giảm dù sản lượng tăng.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm thép, tại sao bán nhiều hơn mà lãi không theo,
  thép chịu gì từ thuế chống bán phá giá hay giá than/quặng.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết → `danh-gia-vi-mo-viet-nam`.
  - Phân khúc xây dựng nói chung (xi măng, kính, vật liệu khác) → đọc cùng `thep-vn`
    nhưng ghi rõ phân khúc, không suy luận chéo.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Spread thành phẩm − nguyên liệu | Spread là chênh lệch giá bán và chi phí nguyên liệu quy về cùng đơn vị; biên lãi gộp = (doanh thu − giá vốn) / doanh thu, không đồng nhất với spread. Quặng sắt và than cốc chiếm phần lớn giá vốn. Chú ý: chi phí nguyên liệu lọt vào báo cáo **chậm** qua tồn kho và thời gian vận chuyển | Giá thành phẩm + quặng/than từ công bố nhà máy, sàn giao dịch hoặc cơ quan ngành qua `web_search`; cùng kỳ, đơn vị, chủng loại và điều kiện giao hàng; đối chiếu `financial_detail` |
| Khối lượng thật | Sản lượng sản xuất và tỷ lệ sử dụng công suất giải thích phân bổ chi phí cố định trên mỗi đơn vị; không nhân sản lượng với tỷ lệ sử dụng lần nữa. Nhà máy mới vận hành chưa đủ công suất làm biên thấp dù doanh thu cao | Sản lượng và tỷ lệ sử dụng: `news_market`/`web_search` (công bố nhà máy) + `financial_detail` (doanh thu, giá vốn) |
| Phòng vệ thương mại | Thuế chống bán phá giá / tự vệ đặt một bức tường giá cho nhập khẩu. Hết hoặc thay đổi phạm vi → giá trong nước chịu áp lực ngay | Văn bản phòng vệ + thay đổi: `news_market`/`web_search`, có nguồn và ngày; nhập khẩu theo nhóm thép lấy từ Hải quan/cơ quan ngành qua `web_search`, có kỳ/đơn vị rõ |
| Cơ cấu sản phẩm | Thép xây dựng phục vụ công trình trong nước, giá bám mùa xây dựng. Thép cuộn nóng giao dịch quốc tế, giá bám khu vực và đơn xuất khẩu — hai logic giá khác nhau | Tỷ trọng sản phẩm: công bố nhà máy trong `news_market`; biên theo mảng trong `financial_detail` |
| Nhu cầu đầu tư công | Giải ngân đầu tư công kéo cầu thép xây dựng phục vụ hạ tầng | Tiến độ giải ngân: `news_market`; số hệ thống qua `danh-gia-vi-mo-viet-nam` nếu user cần sâu |
| Xuất khẩu và thuế thị trường đích | Xuất khẩu là cửa xả dư thừa, nhưng là nơi chịu điều tra chống bán phá giá đầu tiên | Xuất khẩu theo nhóm thép: Hải quan/cơ quan ngành qua `web_search`; rủi ro điều tra: `news_market` |

## Các bước

**Bước 1: Nhận diện mã + cơ cấu sản phẩm (song song).**

`symbol_lookup` · `vn_company` (mảng: xây dựng/HRC/ống tôn/mạ kẽm). Tỷ trọng sản
phẩm lấy từ công bố nhà máy (`news_market`), ghi rõ kỳ.

**Bước 2: Hai đầu spread (song song).**

`web_search` tìm giá từ công bố nhà máy/sàn giao dịch/cơ quan ngành (quặng sắt, than cốc, thép); ghi ngày, kỳ, đơn vị, chủng loại và điều kiện giao hàng trước khi so. `financial_detail` lấy doanh thu, giá vốn → biên lãi gộp theo quý. Bộ COMMO mặc định của `yf_commodities` không có quặng sắt/than cốc/thép: không dùng để dựng spread. Thiếu giá so sánh được thì không tính spread; biên gộp chỉ là dữ liệu bổ trợ.

**Bước 3: Khối lượng + rào phòng vệ (song song).**

`news_market` (sản lượng, tỷ lệ sử dụng công suất, văn bản phòng vệ thương mại,
nhập khẩu) · `web_search` (xuất khẩu thép theo nhóm hàng từ Hải quan/cơ quan ngành; không lấy chuỗi theo quốc gia từ `vs_xnk_detail` làm nhóm hàng).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` (kế hoạch năm) · `peer_compare` (so chỉ tiêu tổng quan cùng phân khúc) · `analyst_consensus` (neo kỳ vọng).

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định nhà máy thép đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Cặp giá thành phẩm − nguyên liệu có so sánh được không?
├─ Spread nở, cùng kỳ/đơn vị/chủng loại → ghi thuận lợi, tiếp Q2
├─ Spread hẹp → ghi áp lực chi phí/giá bán và độ trễ tồn kho, tiếp Q2
└─ Chưa dựng được spread → ghi thiếu, chỉ dùng biên gộp bổ trợ, tiếp Q2

Q2. Khối lượng bán và tỷ lệ sử dụng công suất ra sao?
├─ Tăng, đủ phân bổ chi phí cố định → ghi thuận lợi, tiếp Q3
├─ Giảm hoặc nhà máy mới chưa đủ tải → ghi áp lực công suất, tiếp Q3
└─ Chưa có số liệu → ghi thiếu dữ liệu sản lượng, tiếp Q3

Q3. Rào phòng vệ và cơ cấu sản phẩm đang thay đổi thế nào?
├─ Giá bán giữ được, thị trường đích ổn → ghi thuận lợi, tiếp Q4
├─ Thuế/phạm vi thay đổi gây áp lực nhập khẩu hoặc xuất khẩu → ghi rủi ro có văn bản/ngày, tiếp Q4
└─ Chưa xác minh được → ghi chưa rõ chính sách/cơ cấu, tiếp Q4

Q4. Tồn kho và biên gộp có xác nhận tín hiệu giá/khối lượng không?
├─ Spread nở + sản lượng tăng + biên cải thiện, có nguồn cùng kỳ → ★ "Được tiếp sức; tách tác động giá, lượng và tồn kho"
├─ Có bằng chứng spread hẹp hoặc công suất thấp, biên co → ★ "Bị siết theo yếu tố đã xác minh; không khẳng định đã ở đáy"
└─ Dữ liệu thiếu, trái chiều hoặc chỉ có biên gộp → ★ "Chưa đủ dữ liệu kết luận tổng thể; nêu tín hiệu đã biết và cần bổ sung"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành thép + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Thép là ngành chu kỳ: định giá bằng **EV/EBITDA theo vòng** và **P/B so mức đáy
của chính ngành**, không dùng P/E tại đỉnh chu kỳ. Lãi trên mỗi tấn thép phải đọc
cùng tỷ lệ sử dụng công suất — cùng một mức P/E có thể là đỉnh hoặc đáy tuỳ vị thế
trong vòng. Neo kỳ vọng bằng `planned_targets` và `analyst_consensus`. Nhà máy
trong giai đoạn ramp-up: ghi rõ công suất đã vận hành so với thiết kế.

## Rủi ro đặc thù

- **Rủi ro spread hai chiều kép**: giá bán giảm và nguyên liệu tăng cùng lúc —
  đây là trạng thái thường nhất của giai đoạn khó, không phải ngoại lệ.
- **Rủi ro tồn kho nguyên liệu**: giá đầu vào vào báo cáo với độ trễ, biên còn xấu
  thêm vài quý sau khi giá thị trường đã đảo chiều.
- **Rủi ro phòng vệ thương mại đổi chiều**: hết hoặc thay đổi phạm vi văn bản là
  cú sốc giá trực tiếp cho thị phần trong nước.
- **Rủi ro điều tra từ thị trường đích**: xuất khẩu cao đồng nghĩa rủi ro điều tra
  cao ở chính thị trường đó.
- **Rủi ro nhà máy mới**: tỷ lệ sử dụng công suất thấp trong giai đoạn ramp-up.

## Ranh giới

- Không xác định pha thị trường, không suy "thép sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán, không đặt tỷ trọng → `phan-tich-chuyen-sau-1-ma`.
- Không suy ngưỡng thuế chống bán phá giá hay diện tích điều tra từ trí nhớ: tra
  văn bản hiện hành, ghi nguồn và ngày (luật này chỉ nằm ở đây).
- Không dùng giá thép thế giới của nguồn ngoài thay giá bán thực tế của công ty —
  công bố giá bán trong `news_market` mới là giá áp dụng.

## Giới hạn

- Giá nguyên liệu từ nguồn công bố có ngày là giá tham chiếu, không
  phải giá hợp đồng thực mua của từng nhà máy — ghi rõ khi dùng.
- Tỷ trọng sản phẩm và tỷ lệ sử dụng công suất là công bố không định kỳ; thiếu thì
  hạ độ tin cậy nhánh Q2/Q4.
- Văn bản phòng vệ thương mại có thời hạn và phạm vi thay đổi: kết luận phải ghi
  ngày văn bản đang áp dụng.

## Ví dụ

**Ví dụ 1:**
Hỏi: Bán nhiều thép hơn mà lãi không theo, tại sao?
Đạt khi: có cặp giá thành phẩm − nguyên liệu với 2 đầu kỳ nào, sản lượng/tỷ lệ sử
dụng, biên lãi gộp theo quý, độ trễ tồn kho, và verdict theo cây Q1→Q4.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
waterfall từ giá bán trừ nguyên liệu ra biên/tấn, multiline giá thành phẩm với
giá quặng/than, bar biên lãi gộp của nhóm. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc biên lãi gộp, chi phí tài chính phục vụ tồn kho, sản lượng và cách đối chiếu đầu vào–đầu ra |
