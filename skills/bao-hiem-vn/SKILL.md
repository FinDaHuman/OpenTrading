---
name: bao-hiem-vn
description: "Đọc ngành bảo hiểm VN: phi nhân thọ (bồi thường, combined ratio, tái bảo hiểm), nhân thọ (phí khai thác mới, duy trì hợp đồng), lãi đầu tư. Dùng khi hỏi nhóm bảo hiểm."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_statements, financial_ratios, valuation_run, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bảo hiểm, nhóm bảo hiểm, cổ phiếu bảo hiểm, công ty bảo hiểm, doanh nghiệp bảo hiểm, hãng bảo hiểm, bảo hiểm phi nhân thọ, tỷ lệ bồi thường, tái bảo hiểm, bancassurance]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Bảo hiểm Việt Nam — framework phân tích

Bảo hiểm có **hai nguồn lãi**: nghiệp vụ bảo hiểm (phí thu được trừ bồi thường và chi
phí) và **đầu tư** (quỹ dự phòng gửi ngân hàng, mua trái phiếu, cổ phiếu). Hai nguồn
này nhạy với hai thứ khác nhau: nghiệp vụ nhạy chất lượng khai thác và tổn thất; đầu
tư nhạy lãi suất. Ngành có hai mô hình khác hẳn:

- **Phi nhân thọ** (phần lớn mã niêm yết): hợp đồng ngắn hạn (xe cơ giới, sức khoẻ, tài
  sản – kỹ thuật, hàng hải). Đọc bằng tỷ lệ bồi thường, tỷ lệ chi phí, **combined ratio**
  (bồi thường + chi phí trên phí thuần) và mức tái bảo hiểm.
- **Nhân thọ**: hợp đồng dài hạn. Đọc bằng phí khai thác mới, tỷ lệ duy trì hợp đồng và
  kênh phân phối (đại lý, qua ngân hàng). Một đợt mất niềm tin có thể kéo phí mới thấp
  nhiều năm.

BCTC bảo hiểm theo mẫu riêng: tra tên dòng bằng `vs_financial_norms(btype=5)`.

## Khi nào dùng

- Dùng khi: hỏi nhóm bảo hiểm đang được tiếp sức hay bị siết, một hãng bảo hiểm có hồi
  phục thật không, vì sao lãi tăng mà phí giảm.
- Khi KHÔNG dùng:
  - Pha thị trường, bảo hiểm có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Có nên mua một gói bảo hiểm cho bản thân → không thuộc skill này.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Phí bảo hiểm | Phi nhân thọ: phí gốc theo nghiệp vụ, bám tín dụng, xe mới, đầu tư; nhân thọ: phí khai thác mới (năm đầu) là tăng trưởng tương lai, phí tái tục là quỹ hiện tại | KQKD: doanh thu phí bảo hiểm; phí khai thác mới: công bố công ty, hiệp hội bảo hiểm qua `web_search` |
| Bồi thường và chi phí (phi nhân thọ) | Combined ratio dưới 100% là nghiệp vụ có lãi; thiên tai, dịch bệnh, cạnh tranh phí làm tỷ lệ bồi thường tăng | KQKD: chi bồi thường, chi phí kinh doanh bảo hiểm, phí bảo hiểm thuần |
| Tái bảo hiểm | Nhượng tái nhiều thì ít rủi ro tổn thất lớn nhưng giữ lại ít phí; thu bồi thường nhượng tái đỡ năm có tổn thất lớn | KQKD: phí nhượng tái, thu bồi thường nhượng tái |
| Duy trì hợp đồng và kênh (nhân thọ) | Hợp đồng huỷ sớm làm quỹ phí co; quy định bán hàng qua ngân hàng chặt hơn làm kênh này chậm lại | Công bố công ty, `web_search` (quy định, ghi văn bản + ngày) |
| Lãi đầu tư | Lợi suất danh mục bám lãi tiền gửi và trái phiếu; tiền gửi đáo hạn tái đầu tư ở lãi thấp hơn thì lãi đầu tư giảm dần | KQKD: doanh thu hoạt động tài chính; CDKT/TM: cơ cấu danh mục đầu tư |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `vs_financial_norms(btype=5)` · `symbol_lookup` · `vn_company`
(phi nhân thọ, nhân thọ hay cả hai; tái bảo hiểm).

**Bước 2 (song song):** `financial_detail(symbol, statement=KQKD)` (phí, nhượng tái,
bồi thường, chi phí, doanh thu tài chính) · `financial_detail(symbol, statement=CDKT)`
(dự phòng nghiệp vụ, đầu tư tài chính) · `financial_detail(symbol, statement=TM)` (phí
theo nghiệp vụ, cơ cấu danh mục), 4–8 quý. Tự tính tỷ lệ bồi thường, tỷ lệ chi phí,
combined ratio, lợi suất đầu tư (công thức ở `references/kpi.md`).

**Bước 3 (song song):** `web_search` (phí khai thác mới toàn ngành, quy định kênh bán,
lãi suất tiền gửi hiện hành) · `news_symbol(symbol)` (tổn thất lớn, thay đổi cổ đông,
tăng vốn).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với doanh nghiệp cùng mô hình;
chỉ báo nghiệp vụ của peer đọc bằng `financial_detail` từng mã, `peer_compare` chỉ trả
P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định doanh nghiệp bảo hiểm đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Mô hình đóng góp lợi nhuận lớn nhất (tập đoàn có cả hai: đi nhánh lớn hơn, nêu
nhánh còn lại ở phần rủi ro)?
├─ Phi nhân thọ, tái bảo hiểm → tiếp Q2
└─ Nhân thọ → tiếp Q3

Q2 (phi nhân thọ). Combined ratio đang đi đâu?
├─ Xấu đi, bồi thường tăng nhanh hơn phí thuần → ★ "Bị siết bởi tổn thất: nghiệp vụ
│  co lãi, đọc nghiệp vụ nào và tổn thất có phải một lần không"
├─ Cải thiện hoặc ổn → tiếp Q4
└─ Không tính được → tiếp Q4, ghi rõ

Q3 (nhân thọ). Phí khai thác mới và duy trì hợp đồng?
├─ Phí mới còn giảm hoặc tỷ lệ duy trì thấp → ★ "Quỹ phí tương lai đang co: lãi hiện
│  tại dựa vào hợp đồng cũ và đầu tư"
├─ Phí mới hồi phục, duy trì tốt → tiếp Q4
└─ Không có số → tiếp Q4, ghi rõ

Q4 (chung). Lợi nhuận đến chủ yếu từ đâu?
├─ Đầu tư là phần lớn, nghiệp vụ hoà hoặc lỗ → ★ "Lãi dựa lãi suất: hạ độ tin cậy khi
│  lãi tiền gửi giảm, không gọi là hồi phục nghiệp vụ"
├─ Nghiệp vụ là phần đáng kể → tiếp Q5
└─ Chưa tách được → tiếp Q5, ghi rõ

Q5 (chung). Lợi suất danh mục đầu tư?
├─ Ổn hoặc tăng → ★ "Được tiếp sức: nghiệp vụ có lãi và đầu tư giữ được"
├─ Giảm vì tái đầu tư ở lãi thấp hơn → ★ "Lãi đầu tư sẽ thu hẹp: tăng trưởng lợi nhuận
│  phải đến từ nghiệp vụ"
└─ Không tính được → ★ "Nghiệp vụ là tín hiệu chính, chưa đọc được đầu tư: độ tin cậy
   trung bình"

## Chỉ báo đặc thù ngành

Tên dòng theo statement và công thức tự tính ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Bảo hiểm định giá chủ yếu bằng **P/B neo ROE** và chất lượng nghiệp vụ;
`valuation_run(symbol, btype=5)` cho vùng giá. P/E chỉ dùng khi đã tách lãi đầu tư một
lần (bán cổ phiếu, hoàn nhập). Nhân thọ thường định giá theo giá trị nội tại (EV) do công
ty công bố — dùng nếu có, ghi nguồn. Không so P/B bảo hiểm với ngân hàng.

## Rủi ro đặc thù

- Tổn thất lớn (thiên tai, cháy nổ) làm combined ratio vượt 100% trong một kỳ.
- Cạnh tranh hạ phí ở nghiệp vụ xe, sức khoẻ.
- Lãi tiền gửi giảm làm lãi đầu tư thu hẹp dần.
- Nhân thọ: mất niềm tin, huỷ hợp đồng sớm, quy định bán qua ngân hàng chặt hơn.
- Dự phòng nghiệp vụ trích thiếu làm lãi kỳ này đẹp hơn thực tế.

## Ranh giới

- Không xác định pha thị trường, không nói "bảo hiểm là nơi trú ẩn" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán; không tư vấn mua sản phẩm bảo hiểm.
- Không gọi là hồi phục khi chỉ có lãi đầu tư tăng.
- Không nêu quy định bán hàng, room nước ngoài, vốn tối thiểu từ trí nhớ: tra văn bản,
  ghi số hiệu + ngày (luật này chỉ nằm ở đây).

## Giới hạn

- Phí khai thác mới, tỷ lệ duy trì không có trong BCTC; công bố không đều — ghi rõ khi
  thiếu.
- Tên dòng KQKD bảo hiểm khác nhau giữa doanh nghiệp; luôn đối chiếu với
  `vs_financial_norms(btype=5)`.

## Ví dụ

Hỏi: Hãng bảo hiểm này có thật sự hồi phục không?
Đạt khi: nêu mô hình, có combined ratio hoặc phí khai thác mới (theo mô hình) 4 kỳ, tách
nghiệp vụ và đầu tư, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường combined ratio theo quý,
cột chồng lãi nghiệp vụ và lãi đầu tư, cột phí theo nghiệp vụ. Vẽ bằng `chart_render`
với `from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có; cần chọn loại hình
thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần tên dòng BCTC bảo hiểm theo statement, công thức tỷ lệ bồi thường, combined ratio, lợi suất đầu tư |
