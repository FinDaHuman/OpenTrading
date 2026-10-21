---
name: bao-hiem-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích bảo hiểm nhân thọ/phi nhân thọ: phí mới, duy trì hợp đồng, bồi thường, combined ratio, tái bảo hiểm và thu nhập đầu tư; tách nghiệp vụ và kênh phân phối."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bảo hiểm, hãng bảo hiểm, bảo hiểm phi nhân thọ, bảo hiểm nhân thọ, phí bảo hiểm, bancassurance, công ty bảo hiểm]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Bảo hiểm Việt Nam — framework phân tích

Phân biệt **nhân thọ, phi nhân thọ và tập đoàn hỗn hợp** trước khi chọn chỉ báo.
Nhân thọ đọc phí mới, duy trì hợp đồng và chi phí khai thác; phi nhân thọ đọc phí
được hưởng, tỷ lệ bồi thường, combined ratio và tái bảo hiểm. Hỗn hợp phải tách
mảng và loại trừ giao dịch nội bộ; không dùng bộ phí mới để kết luận cả tập đoàn.
Cả hai đều cần tách kết quả nghiệp vụ khỏi đầu tư, dự phòng và khoản bất thường.

## Khi nào dùng

- Hỏi xu hướng ngành, sức khỏe công ty bảo hiểm, chất lượng nghiệp vụ hoặc nguyên nhân lãi tăng/phí giảm.
- Pha thị trường, luân chuyển ngành → `dinh-vi-chu-ky-vn`; phân tích toàn diện mã → `phan-tich-chuyen-sau-1-ma`; định giá riêng → `dinh-gia-chuyen-sau`; BCTC tổng quát → `co-ban-chuyen-sau`.
- Hỏi bancassurance của ngân hàng: phối hợp `ngan-hang-vn`, không coi phí ngân hàng là phí bảo hiểm của hãng.

## Trụ cột driver

| Mảng/driver | Chỉ báo và cơ chế | Nguồn |
|---|---|---|
| Nhân thọ | Phí mới/APE theo định nghĩa công bố, phí tái tục, duy trì hợp đồng cùng cohort/thời hạn, chi phí khai thác và nghĩa vụ hợp đồng | Công bố hãng/hiệp hội có kỳ và định nghĩa; không suy duy trì từ doanh thu phí tổng |
| Phi nhân thọ | Phí gốc, phí giữ lại, phí được hưởng, bồi thường phát sinh và combined ratio; tăng phí nhưng bồi thường/chi phí cao có thể làm nghiệp vụ lỗ | BCTC và thuyết minh theo `vs_financial_norms(btype=5)`; tính theo `references/kpi.md` |
| Tái bảo hiểm | Tỷ lệ nhượng, thu hồi bồi thường, dự phòng và rủi ro đối tác; kiểm tra biến động gộp/ròng | `financial_detail(statement=TM)` hoặc thuyết minh hãng |
| Đầu tư | Thu nhập đầu tư thường xuyên, lãi/lỗ thực hiện/chưa thực hiện, lợi suất và kỳ hạn tài sản so nghĩa vụ | `KQKD`, `CDKT`, `TM` và công bố cùng kỳ |
| Dự phòng và khả năng thanh toán | Tăng dự phòng có thể do nghĩa vụ hoặc giả định thay đổi, không tự đồng nghĩa sổ khỏe; vốn kế toán không chứng minh đạt biên khả năng thanh toán | BCTC và công bố an toàn vốn theo quy định áp dụng |
| Kênh bán và chính sách | Đại lý, ngân hàng, kênh trực tiếp có chi phí/chất lượng bán khác nhau | `news_symbol`, công bố hãng, `news_market` cho số ngành; luật phải tra văn bản + ngày hiệu lực |

## Các bước

**Bước 1 — Xác định mảng và chuẩn mực.** `symbol_lookup` · `vn_company` ·
`vs_financial_norms(btype=5)` trước khi chọn dòng. Phân loại nhân thọ/phi nhân thọ/
hỗn hợp theo doanh thu, lợi nhuận và nghĩa vụ công bố; chưa rõ thì không ép phân loại.

**Bước 2 — Nghiệp vụ theo mảng.** Gọi riêng `financial_detail(statement=KQKD)`,
`financial_detail(statement=CDKT)` và `financial_detail(statement=TM)`; không truyền
`btype` vào tool này. Thiếu KPI đặc thù thì lấy báo cáo hãng/hiệp hội qua nguồn có
thể kiểm chứng, ghi rõ kỳ. Nhân thọ dùng phí mới/duy trì; phi nhân thọ dùng tỷ lệ
bồi thường/combined ratio/tái bảo hiểm. Không lấy tin thị trường thay số riêng hãng.

**Bước 3 — Chất lượng lợi nhuận.** Đối chiếu nghiệp vụ, dự phòng, đầu tư, kỳ hạn
và thanh khoản; không lấy thu nhập tài chính tăng làm bằng chứng nghiệp vụ hồi phục.
Không trừ doanh thu đầu tư khỏi lãi hợp nhất để tạo ra “lãi bảo hiểm thuần” khi thiếu
chi phí, thuế hoặc phân bổ cùng cơ sở.

**Bước 4 — So sánh và kỳ vọng.** `planned_targets` · `analyst_consensus` ·
`peer_compare` chỉ cho key tổng quan thực trả (ví dụ P/B, ROE), không tạo phí mới,
combined ratio qua `metrics`. KPI ngành lấy từ `financial_detail`/công bố từng peer
cùng phân khúc, kỳ và cơ sở gộp/ròng.

## Cây quyết định công ty bảo hiểm đang được tiếp sức hay siết

Ghi trạng thái trung gian rồi đi tiếp; chỉ dừng ở ★. Thiếu số không là tín hiệu xấu.

Q1. Công ty thuộc phân khúc nào?
├─ Nhân thọ → ghi bộ phí mới, duy trì, chi phí khai thác → Q2
├─ Phi nhân thọ → ghi bộ phí được hưởng, bồi thường, combined ratio → Q2
├─ Hỗn hợp → tách cả hai mảng, giữ tỷ trọng và loại trừ hợp nhất → Q2
└─ Chưa phân loại được → ★ "Chưa đủ dữ liệu chọn bộ KPI bảo hiểm"

Q2. Nghiệp vụ của từng mảng có cải thiện không?
├─ Phí mới/duy trì nhân thọ cải thiện hoặc combined ratio phi nhân thọ giảm cùng cơ sở → ghi nghiệp vụ thuận → Q3
├─ Chỉ tiêu nghiệp vụ xấu đi → ghi áp lực nghiệp vụ → Q3
└─ Thiếu, trái chiều hoặc khác cơ sở → ghi chưa rõ nghiệp vụ → Q3

Q3. Dự phòng và tái bảo hiểm có gây rủi ro không?
├─ Đủ thông tin, thu hồi và dự phòng phù hợp nghĩa vụ → ghi rủi ro được kiểm soát → Q4
├─ Dự phòng tăng do tổn thất/thu hồi tái bảo hiểm chậm hoặc đối tác yếu → ghi áp lực → Q4
└─ Thiếu thuyết minh → ghi chưa rõ chất lượng nghĩa vụ → Q4

Q4. Lãi cải thiện đến từ đâu?
├─ Nghiệp vụ và đầu tư thường xuyên cùng cải thiện → ghi chất lượng lãi thuận → Q5
├─ Chủ yếu đầu tư hoặc khoản một lần → ghi phụ thuộc thị trường/lãi suất → Q5
├─ Cả hai suy yếu → ghi áp lực lợi nhuận → Q5
└─ Chưa tách được → ghi chưa rõ nguồn lãi → Q5

Q5. Kênh bán và chính sách hiện hành tác động thế nào?
├─ Có bằng chứng thuận, ngày hiệu lực và chi phí tuân thủ rõ → ★ "Có động lực hỗ trợ; kết luận từng mảng phải giữ các rủi ro nghiệp vụ/đầu tư đã ghi"
├─ Có bằng chứng siết kênh/chi phí tuân thủ → ★ "Có áp lực kênh/chính sách; đánh giá cùng sức khỏe nghiệp vụ đã ghi"
└─ Chưa xác minh hoặc không có thay đổi đáng kể → ★ "Chưa có căn cứ chốt động lực chính sách; kết luận giới hạn ở KPI đã xác minh"

## Chỉ báo đặc thù ngành

Đọc `references/kpi.md` để chọn công thức và cơ sở gộp/ròng, phí ghi nhận/phí được
hưởng, cùng kỳ và cùng chuẩn mực. Mẫu số thiếu hoặc bằng không thì không tính tỷ lệ.

## Định giá theo đặc thù ngành

Dùng P/B cùng ROE, chất lượng dự phòng và vốn; P/E trên lợi nhuận chuẩn hóa sau
chi phí và thuế cùng phạm vi. Nhân thọ có thể tham khảo embedded value nếu hãng
công bố phương pháp và giả định; không tự tạo giá trị từ tổng phí. Hỗn hợp dùng
SOTP nếu đủ dữ liệu, không so lãi hợp nhất với lãi nghiệp vụ đơn mảng.

## Rủi ro đặc thù

Bán sai sản phẩm và hợp đồng hủy, thiên tai/bồi thường lớn, phát triển dự phòng,
đối tác tái bảo hiểm, lệch kỳ hạn tài sản/nghĩa vụ và thị trường đầu tư đều cần xét.
Combined ratio tốt do nhượng rủi ro nhiều hơn có thể đổi chi phí và lợi nhuận giữ lại.

## Ranh giới và giới hạn

Không xác định pha/sóng hoặc chọn mã mua bán. Không suy luật, room sở hữu hay
ngưỡng an toàn vốn từ trí nhớ: tra văn bản và kỳ áp dụng. Không suy duy trì hợp đồng
hoặc tỷ lệ bồi thường từ số phí tổng; thiếu KPI thì ghi chưa đủ dữ liệu. Không gọi
dự phòng tăng là tích cực khi chưa hiểu nghĩa vụ. Công bố khác cơ sở phải giải thích
hoặc dừng so sánh.

## Ví dụ

Hỏi: Bảo hiểm phi nhân thọ có phục hồi thật không?
Đạt khi: có phí được hưởng, bồi thường, combined ratio, tái bảo hiểm và lợi suất đầu
tư cùng kỳ; tách chất lượng nghiệp vụ với đầu tư, đi cây theo phân khúc.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn; tối đa một biểu đồ, dữ liệu đã xác minh qua
`chart_render(from_call=...)`. Nhân thọ: phí mới/duy trì; phi nhân thọ: combined
ratio; hỗn hợp: kết quả theo mảng. Cần loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Công thức KPI nhân thọ/phi nhân thọ, tái bảo hiểm và đầu tư |
