---
name: bao-hiem-vn
description: "Phân tích ngành bảo hiểm Việt Nam theo phí bảo hiểm mới, tỷ lệ duy trì hợp đồng, thu nhập bảo hiểm so với thu nhập tài chính và cơ cấu kênh phân phối. Dùng khi hỏi xu hướng ngành bảo hiểm."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [bảo hiểm, ngành bảo hiểm, nhân thọ, phi nhân thọ, phí bảo hiểm, bancassurance, hợp đồng bảo hiểm, doanh thu phí bảo hiểm, công ty bảo hiểm]
version: 1.0.0
---

# Bảo hiểm Việt Nam — framework phân tích

Bảo hiểm là **ngành niềm tin**: doanh thu phí phụ thuộc khả năng bán hàng đúng quy
tắc, và một đợt mất niềm tin có thể kéo sản phẩm mới xuống đáy trong nhiều năm. Ngoài
ra, ngành có **hai nguồn lãi khác nhau**: nghiệp vụ bảo hiểm (thu phí, trả bồi
thường) và thu nhập tài chính (đầu tư quỹ phí). Trong giai đoạn lãi suất cao, một
công ty có thể đẹp trên báo cáo vì quỹ phí cũ đang thu lãi tốt, trong khi nghiệp vụ
bảo hiểm đang teo.

Skill này đọc ngành bằng phí mới, tỷ lệ duy trì hợp đồng, tỷ lệ phân chia nghiệp vụ
và tài chính, cơ cấu kênh bán, và mức độ sụt giảm quy mô so với đáy trong quá khứ.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng ngành bảo hiểm, một hãng bảo hiểm có đang hồi phục
  không, tại sao lãi tăng mà phí giảm.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Ngân hàng (kênh bán bảo hiểm qua ngân hàng) → `ngan-hang-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Phí bảo hiểm mới | Nguồn tăng trưởng tương lai: phí mới teo 3 năm liền nghĩa sản lượng mới đang rất thấp, cần thời gian phục hồi dù niềm tin đã về | Hiệp hội bảo hiểm + công bố công ty: `news_market`/`web_search` |
| Tỷ lệ duy trì hợp đồng | Hợp đồng bị huỷ sớm làm teo quỹ phí bền vững; đây là chỉ báo chất lượng bán hàng **sau** mọi khủng hoảng niềm tin | Tỷ lệ duy trì: công bố công ty hoặc ước tính từ nghiệp vụ trong `financial_detail` |
| Nghiệp vụ so với tài chính | Thu nhập tài chính nhạy lãi suất; nghiệp vụ bảo hiểm nhạy chất lượng bán hàng. Tách hai nguồn trước khi kết luận hồi phục | Mảng nghiệp vụ và mảng tài chính trong `financial_detail` |
| Cơ cấu kênh phân phối | Bảo hiểm qua ngân hàng (bancassurance) và đại lý: kênh bị siết sau khủng hoảng niềm tin, kênh đại lý hồi phục chậm nhưng bền | Tỷ trọng kênh: `news_market`; chỉ báo ngành: hiệp hội bảo hiểm |
| Mức độ sụt giảm so với đáy | Sản phẩm mới có thể rơi về mức trước đợt tăng trưởng bùng nổ — đọc theo năm để biết đang ở vùng đáy hay hồi phục | Số liệu phí mới theo năm: `news_market`/`web_search` |
| Chính sách | Quy định bán hàng, minh bạch hoá sản phẩm, giới hạn sở hữu nước ngoài ảnh hưởng chiến lược công ty | Văn bản: `news_market`/`web_search`, ghi rõ nguồn + ngày |

## Các bước

**Bước 1: Nhận diện mảng (song song).**

`symbol_lookup` · `vn_company` (nhân thọ / phi nhân thổ / tài chính / dịch vụ) ·
`financial_detail` (doanh thu theo mảng). BCTC bảo hiểm đọc qua
`vs_financial_norms(btype=5)`.

**Bước 2: Phí mới + chất lượng sổ (song song).**

`news_market` (phí mới ngành, chính sách, kênh bán) · `financial_detail` (doanh
thu phí, thu nhập tài chính, dự phòng nghiệp vụ).

**Bước 3: Hai nguồn lãi (song song).**

`financial_detail`: tách thu nhập nghiệp vụ bảo hiểm với thu nhập tài chính.
Nghiệp vụ cải thiện là tín hiệu hồi phục thật; chỉ có thu nhập tài chính tăng là
tín hiệu phụ thuộc lãi suất.

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `peer_compare` (so phí mới, chênh lệch nghiệp vụ/tài chính
trong nhóm cùng phân khúc) · `analyst_consensus`.

## Cây quyết định công ty bảo hiểm đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Phí mới của ngành đang ở đâu so với đáy lịch sử?
├─ Đang hồi phục từ đáy → tiếp Q2
├─ Vẫn ở đáy hoặc chưa rõ → tiếp Q2 với độ tin cậy thấp, ghi rõ ngành vẫn trong giai
   đoạn tích lũy niềm tin
└─ Chưa có số liệu → Q2 với độ tin cậy thấp

Q2. Cải thiện trên báo cáo đến từ đâu?
├─ Từ nghiệp vụ bảo hiểm (phí và biên nghiệp vụ) → tiếp Q3
├─ Chủ yếu từ thu nhập tài chính → ★ "Lãi dựa lãi suất, không dựa nghiệp vụ: đọc
   nhạy lãi suất — hạ độ tin cậy khi lãi suất đảo chiều"
└─ Chưa tách được hai nguồn → tiếp Q3 với độ tin cậy thấp, ghi rõ

Q3. Kênh bán đang lành lại không?
├─ Có, kênh truyền thống/đại lý đang phục hồi và kênh mới mở rộng → tiếp Q4
├─ Kênh bị siết hoặc công ty chuyển mô hình → ★ "Bị siết bởi kênh: đọc chi phí
   thuê/hoa hồng và thời gian xây lại đội ngũ"
└─ Chưa rõ → tiếp Q4 với độ tin cậy thấp

Q4. Chất lượng sổ bảo hiểm có cải thiện không?
├─ Có, tỷ lệ duy trì hợp đồng tăng, dự phòng nghiệp vụ bền vững → tiếp Q5
├─ Chưa rõ hoặc xấu → ★ "Chất lượng sổ chưa rõ: đọc dự phòng và chi phí bồi thường
   trước khi tin tăng trưởng phí"
└─ Thiếu chỉ báo → Q5 với độ tin cậy thấp

Q5. Chính sách đang mở hay siết?
├─ Mở (minh bạch, cho phép mô hình mới, nới room nước ngoài) → ★ "Được tiếp sức bởi
   thể chế: đọc chi phí tuân thủ và chính sách room ngoài rồi mới kỳ vọng thị phần"
└─ Siết hoặc chưa rõ → ★ "Bị siết bởi thể chế: đọc chi phí tuân thủ và giới hạn sở
   hữu trước khi kỳ vọng tăng trưởng"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành bảo hiểm + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Bảo hiểm định giá bằng **P/B neo giá trị sổ sách và chất lượng nghiệp vụ** (thu nhập
nghiệp vụ bảo hiểm trừ thu nhập tài chính một lần) và **P/E trên lãi bảo hiểm thuần**
không phải lãi hợp nhất. Không so giá trị vốn hoá với nhóm ngân hàng được — mô hình
và mức độ an toàn khác nhau. Neo kỳ vọng bằng `planned_targets` và
`analyst_consensus`.

## Rủi ro đặc thù

- **Rủi ro niềm tin**: một đợt bán hàng sai quy tắc kéo sản lượng mới xuống đáy
  nhiều năm.
- **Rủi ro lãi suất giảm**: thu nhập tài chính là nguồn lãi chính trong giai đoạn
  lãi cao; lãi suất hạ làm lãi giảm nhanh hơn nghiệp vụ phục hồi.
- **Rủi ro chất lượng sổ**: hợp đồng bị huỷ sớm làm teo quỹ phí bền vững.
- **Rủi ro cạnh tranh từ ngân hàng**: ngân hàng tự lập hoặc góp vốn vào công ty bảo
  hiểm làm cạnh tranh kênh.
- **Rủi ro đọc lẫn nguồn lãi**: lãi tăng nhờ tài chính trong khi nghiệp vụ teo không
  phải hồi phục.

## Ranh giới

- Không xác định pha thị trường, không suy "bảo hiểm là nơi trú ẩn theo chu kỳ" →
  `dinh-vi-chu-ky-vn` (nơi giữ vai trò các mảng theo pha).
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không kết luận hồi phục khi chỉ có thu nhập tài chính tăng.
- Không suy luật bán hàng hoặc room nước ngoài từ trí nhớ: tra văn bản, ghi nguồn.

## Giới hạn

- Phí mới ngành là số định kỳ, có thể chưa đầy đủ cho mọi hãng: thiếu thì hạ độ tin
  cậy nhánh Q1.
- Thu nhập nghiệp vụ và tài chính không phải kỳ nào cũng tách riêng rõ ràng: khi
  không tách được, ghi rõ đang dùng lãi hợp nhất.
- Niềm tin là yếu tố không đo bằng số trực tiếp: chỉ nhận biết qua phí mới và tỷ lệ
  duy trì hợp đồng, không kết luận chắc chắn.

## Ví dụ

**Ví dụ 1:**
Hỏi: Hãng bảo hiểm này có thật sự hồi phục không?
Đạt khi: tách được nghiệp vụ và tài chính, có phí mới ngành + nguồn, chỉ báo chất
lượng sổ, và verdict theo cây Q1→Q5.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
waterfall từ phí mới ra thu nhập nghiệp vụ và tài chính, bar thu nhập nghiệp vụ/tài
chính theo kỳ, multiline phí mới theo năm. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách tách thu nhập nghiệp vụ/tài chính, đọc phí mới và chỉ báo chất lượng sổ |
