---
name: thep-vn
description: "Phân tích ngành thép VN theo spread nguyên liệu–thành phẩm, phòng vệ thương mại, cơ cấu sản phẩm và biên lãi gộp. Dùng khi hỏi xu hướng nhóm thép, đọc kết quả nhà máy thép, lãi gộp hay chi phí đầu vào."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, vs_xnk_detail, symbol_lookup, vn_company]
triggers:
  keywords: [ngành thép, thép xây dựng, thép cuộn, nhà máy thép, sản xuất thép, giá thép, thép nhập khẩu, sản lượng thép, lãi gộp thép, chi phí đầu vào thép]
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
| Spread thành phẩm − nguyên liệu | Biên lãi gộp = giá bán trung bình − giá vốn/nguyên liệu. Quặng sắt và than cốc chiếm phần lớn giá vốn. Chú ý: chi phí nguyên liệu lọt vào báo cáo **chậm** qua tồn kho và thời gian vận chuyển | Giá bán thành phẩm + giá quặng/than: `yf_commodities` (kim loại và năng lượng) đối chiếu giá bán trong `financial_detail` và `news_market` |
| Khối lượng thật | Sản lượng × tỷ lệ sử dụng công suất quyết định phân bổ chi phí cố định. Nhà máy mới vận hành chưa đủ công suất làm biên thấp dù doanh thu cao | Sản lượng và tỷ lệ sử dụng: `news_market`/`web_search` (công bố nhà máy) + `financial_detail` (doanh thu, giá vốn) |
| Phòng vệ thương mại | Thuế chống bán phá giá / tự vệ đặt một bức tường giá cho nhập khẩu. Hết hoặc thay đổi phạm vi → giá trong nước chịu áp lực ngay | Văn bản phòng vệ + thay đổi: `news_market`/`web_search`, có nguồn và ngày; nhập khẩu đối chiếu `vs_xnk_detail` |
| Cơ cấu sản phẩm | Thép xây dựng phục vụ công trình trong nước, giá bám mùa xây dựng. Thép cuộn nóng giao dịch quốc tế, giá bám khu vực và đơn xuất khẩu — hai logic giá khác nhau | Tỷ trọng sản phẩm: công bố nhà máy trong `news_market`; biên theo mảng trong `financial_detail` |
| Nhu cầu đầu tư công | Giải ngân đầu tư công kéo cầu thép xây dựng phục vụ hạ tầng | Tiến độ giải ngân: `news_market`; số hệ thống qua `danh-gia-vi-mo-viet-nam` nếu user cần sâu |
| Xuất khẩu và thuế thị trường đích | Xuất khẩu là cửa xả dư thừa, nhưng là nơi chịu điều tra chống bán phá giá đầu tiên | Xuất khẩu: `vs_xnk_detail`; rủi ro điều tra: `news_market` |

## Các bước

**Bước 1: Nhận diện mã + cơ cấu sản phẩm (song song).**

`symbol_lookup` · `vn_company` (mảng: xây dựng/HRC/ống tôn/mạ kẽm). Tỷ trọng sản
phẩm lấy từ công bố nhà máy (`news_market`), ghi rõ kỳ.

**Bước 2: Hai đầu spread (song song).**

`yf_commodities` (quặng sắt, than cốc, thép thế giới) · `financial_detail` (doanh
thu, giá vốn hàng bán → biên lãi gộp theo quý). Ghi rõ giá đầu vào tra từ đâu và
kỳ nào.

**Bước 3: Khối lượng + rào phòng vệ (song song).**

`news_market` (sản lượng, tỷ lệ sử dụng công suất, văn bản phòng vệ thương mại,
nhập khẩu) · `vs_xnk_detail` (xuất khẩu thép và sản phẩm thép theo kỳ).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` (kế hoạch năm) · `peer_compare` (so biên lãi gộp, chi phí tài
chính/tồn kho trong nhóm) · `analyst_consensus` (neo kỳ vọng).

## Cây quyết định nhà máy thép đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Cặp giá thành phẩm − nguyên liệu đang nở hay hẹp?
├─ Nở (thành phẩm tăng hoặc giữ, quặng/than giảm) → tiếp Q2
├─ Hẹp (thành phẩm giảm hoặc quặng/than tăng) → tiếp Q3 (vẫn có thể là cơ hội
   nếu là do giãn tồn kho)
└─ Chưa dựng được cặp giá → ghi thiếu dữ liệu, dùng Q4 với độ tin cậy thấp

Q2. Khối lượng có đủ để phân bổ chi phí cố định không?
├─ Có, tỷ lệ sử dụng công suất đang lên → Q4
└─ Chưa, nhà máy mới chưa đủ công suất → ★ "Biên đang bị tỷ lệ sử dụng kìm: đọc
   tiến độ ramp-up trước khi nhìn biên"

Q3. Nguyên nhân hẹp là do nguyên liệu hay do giá bán?
├─ Nguyên liệu tăng (than/quặng) → tiếp Q3b
├─ Giá bán giảm trong khi rào phòng vệ đang bị siết hoặc hết → ★ "Bị siết bởi
   nhập khẩu: giá bán không giữ được, đọc văn bản phòng vệ để xem hướng đi"
└─ Giá bán giảm do cơ cấu chuyển sang sản phẩm giao dịch quốc tế → ★ "Biên chuyển
   theo chu kỳ quốc tế: đọc giá bán khu vực thay vì giá nội địa"

Q3b. Chi phí nguyên liệu đã vào báo cáo chưa?
├─ Chưa toàn bộ (tồn kho giá cao còn chưa tiêu) → ★ "Biên sẽ còn bị nén thêm:
   đọc tồn kho nguyên liệu trước khi kỳ vọng hồi phục"
└─ Đã vào (tồn kho giá mới đang áp) → ★ "Biên đang ở vùng đáy của vòng: spread
   đảo chiều sẽ thấy trước ở giá thị trường, sau ở báo cáo"

Q4. Cơ cấu sản phẩm đang nghiêng về đâu?
├─ Về sản phẩm nội địa (xây dựng) → tiếp Q5
├─ Về sản phẩm giao dịch quốc tế (cuộn nóng) → ★ "Chu kỳ bám giá khu vực và
   cước vận chuyển: đọc hàng tồn + đơn xuất khẩu, cầu nội địa không còn là
   biến quyết định"
└─ Chưa rõ tỷ trọng → tiếp Q5 với độ tin cậy thấp

Q5. Rào phòng vệ thương mại đang bảo vệ hay bị thử thách?
├─ Đang bảo vệ, nhập khẩu giảm → ★ "Được tiếp sức: giá trong nước giữ được, đọc
   khối lượng để xem tăng trưởng bám giá hay bám volume"
├─ Bị điều tra từ thị trường đích xuất khẩu → ★ "Bị siết một đầu: cửa xả dư thừa
   đang bị thu hẹp, đọc tỷ trọng xuất khẩu trong doanh thu"

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

- Giá nguyên liệu từ `yf_commodities` là giá tham chiếu quốc tế theo chu kỳ, không
  phải giá hợp đồng thực mua của từng nhà máy — ghi rõ khi dùng.
- Tỷ trọng sản phẩm và tỷ lệ sử dụng công suất là công bố không định kỳ; thiếu thì
  hạ độ tin cậy nhánh Q2/Q4.
- Văn bản phòng vệ thương mại có thời hạn và phạm vi thay đổi: kết luận phải ghi
  ngày văn bản đang áp dụng.

## Ví dụ

**Ví dụ 1:**
Hỏi: Bán nhiều thép hơn mà lãi không theo, tại sao?
Đạt khi: có cặp giá thành phẩm − nguyên liệu với 2 đầu kỳ nào, sản lượng/tỷ lệ sử
dụng, biên lãi gộp theo quý, độ trễ tồn kho, và verdict theo cây Q1→Q5.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
waterfall từ giá bán trừ nguyên liệu ra biên/tấn, multiline giá thành phẩm với
giá quặng/than, bar biên lãi gộp của nhóm. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc biên lãi gộp, chi phí tài chính phục vụ tồn kho, sản lượng và cách đối chiếu đầu vào–đầu ra |
