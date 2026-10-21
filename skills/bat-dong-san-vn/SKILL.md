---
name: bat-dong-san-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành bất động sản VN theo dòng vốn và pháp lý: tín dụng ngành, kênh trái phiếu và tường đáo hạn, giới hạn vay áp dụng, cơ cấu nhà ở so khu công nghiệp. Dùng khi hỏi xu hướng nhóm BĐS hay đọc BCTC chủ đầu tư."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, analyst_consensus, peer_compare, financial_ratios, stock_overview, news_symbol, news_market, company_events, event_calendar_vn, dividends_splits, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bất động sản, nhóm bất động sản, nhóm bđs, chủ đầu tư, bán trước bất động sản, khu công nghiệp, nhà ở thương mại, bất động sản công nghiệp, dòng tiền bất động sản, doanh nghiệp bất động sản]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Bất động sản Việt Nam — framework phân tích

BĐS VN là ngành **dòng vốn + pháp lý**, không phải ngành "cung – cầu nhà ở" theo
nghĩa đơn giản. Skill này đọc ngành qua bốn dòng vốn vào dự án (tín dụng ngành,
trái phiếu doanh nghiệp, vốn chủ, tiền ứng từ khách hàng), rào pháp lý chặn từng
dòng, và **tách hai chu kỳ khác nhau** của ngành: nhà ở thương mại (dẫn bởi lãi
suất vay và khả năng hấp thụ) so với bất động sản công nghiệp (dẫn bởi dòng vốn
nước ngoài và giá thuê). Nhìn chung một ngành sẽ đọc sai cả hai.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm BĐS, một chủ đầu tư có bị siết vốn không, phân
  khúc nào đang khác gì nhau, tường đáo hạn trái phiếu ảnh hưởng ra sao.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết (lãi suất, tín dụng toàn ngành) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Tín dụng ngành | Dư nợ cho lĩnh vực BĐS quyết định dòng tiền vào dự án. Ngân hàng bị giới hạn tăng trưởng cho từng lĩnh vực theo kỳ → siết/nới là **hành chính**, không phải nhu cầu | Dư nợ BĐS + biên tăng trưởng: `news_market`/`web_search` (số hệ thống theo kỳ); riêng mã đọc nợ vay trong `financial_detail` |
| Kênh trái phiếu + tường đáo hạn | Phát hành trái phiếu tăng nhanh đổi lấy rủi ro tái cơ cấu trung hạn: tường đáo hạn tập trung vài quý là điểm nghẽn. Lãi phát hành tăng = thị trường phát giá rủi ro ngành cao hơn | Phát hành + lãi + tường đáo hạn: `news_market`/`web_search`; riêng mã đọc trái phiếu phát hành trong `financial_detail` |
| Rào pháp lý | Quy định giới hạn (vay ngân hàng + trái phiếu)/vốn chủ theo quy mô dự án làm trần đòn bẩy của cả ngành; Luật Đất đai định kỳ công bố bảng giá đất (+ quy định thay thế khác) đổi chi phí đầu vào | Nội dung văn bản + hiệu lực: `news_market`/`web_search`. **Không suy ngưỡng mới** — tra văn bản hiện hành rồi ghi nguồn |
| Phân khúc | Nhà ở thương mại: lãi vay + khả năng hấp thụ + cung mới. Công nghiệp: dòng vốn nước ngoài + giá thuê + hấp thụ đất. Hai chu kỳ khác chiều được | Bán trước/bàn giao và giá thuê/hấp thụ: `news_market`/`web_search`; riêng mã trong `financial_detail` và `planned_targets` |
| Thanh khoản thị trường | Cung mới đổ về cùng lúc làm giảm khả năng tính giá → biên lãi gộp mảng BĐS bị nén dù doanh thu tăng | Biên lãi gộp mảng BĐS: `financial_detail` |
| Kỳ vọng + phê duyệt | Dự án phải qua chuỗi phê duyệt; kỳ vọng chững lại làm tiến độ chậm và chi phí tài chính đội lên | Tiến độ + sự kiện phê duyệt: `company_events` · `event_calendar_vn` |

## Các bước

**Bước 1: Nhận diện mã + phân khúc (song song).**

`symbol_lookup` · `vn_company` (bảng mảng kinh doanh: nhà ở / công nghiệp / bán lẻ
/ dịch vụ). Thiếu phân khúc rõ → ghi "chưa rõ phân khúc", đọc cả hai nhánh cây.

**Bước 2: Dòng vốn + trần nợ (song song).**

`financial_detail`: nợ vay, trái phiếu phát hành, vốn chủ, chi phí lãi thuần.
`news_market`: dư nợ tín dụng ngành, phát hành trái phiếu ngành, tường đáo hạn.

**Bước 3: Chất lượng bán hàng + tiến độ (song song).**

`financial_detail`: tiền người mua trả trước, chi phí dở dang; doanh số ký bán/backlog lấy từ công bố doanh nghiệp nếu không có dòng tách rõ;
biên lãi gộp mảng BĐS. `planned_targets`: kế hoạch năm làm neo kỳ vọng.

**Bước 4: Riêng phân khúc + vị thế nhóm.**

Công nghiệp: `news_market` (hấp thụ đất, giá thuê, dòng vốn nước ngoài).
Nhà ở: `news_market` (cung mới, lãi vay, chính sách nhà ở). `peer_compare`:
chỉ key tổng quan thực trả như P/B, ROE; so biên, đòn bẩy và chi phí dở dang bằng `financial_detail`/công bố từng peer cùng phân khúc, cùng kỳ.

## Cây quyết định doanh nghiệp đang được tiếp sức hay siết

Duyệt các node theo thứ tự; ghi trạng thái trung gian rồi đi tiếp. Chỉ dừng ở ★.
Thiếu dữ liệu phải ghi rõ và hạ độ tin cậy; không coi thiếu là tín hiệu xấu.

Q1. Doanh nghiệp thuộc phân khúc nào?
├─ Nhà ở → Q2
├─ Công nghiệp → Q4
├─ Cho thuê bán lẻ/dịch vụ → ghi cần doanh thu thuê, lấp đầy và chi phí vận hành → Q5
├─ Đa phân khúc → đánh giá riêng Q2 và Q4, tổng hợp theo tỷ trọng công bố → Q5
└─ Chưa rõ → ★ "Chưa đủ dữ liệu phân khúc để chọn bộ KPI"

Q2. Dòng vốn nhà ở đang thế nào?
├─ Tín dụng/trái phiếu nới → ghi vốn thuận → Q3
├─ Tín dụng siết/lãi huy động cao → ghi áp lực vốn → Q3
└─ Thiếu hoặc trái chiều → ghi chưa rõ dòng vốn → Q3

Q3. Lịch đáo hạn và giới hạn vay áp dụng có gây áp lực không?
├─ Đáo hạn tập trung/gần giới hạn đã xác minh → ghi rủi ro tái cấp vốn → Q5
├─ Nguồn thanh toán đủ, còn dư địa → ghi áp lực vốn được kiểm soát → Q5
└─ Thiếu lịch nợ hoặc căn cứ pháp lý → ghi chưa xác nhận rủi ro vốn → Q5

Q4. FDI, hấp thụ đất và giá thuê công nghiệp có thuận không?
├─ Hấp thụ/giá thuê tăng, có dự án và FDI giải ngân hỗ trợ → ghi cầu thuận → Q5
├─ Hấp thụ/giá thuê yếu → ghi áp lực cầu → Q5
└─ Thiếu/trái chiều → ghi chưa rõ cầu → Q5

Q5. KPI bán hàng/cho thuê và dòng tiền có cải thiện không?
├─ Bán trước/cho thuê, biên và thu tiền cùng cải thiện → ★ "Hoạt động được tiếp sức, nhưng kết luận vốn phải giữ các rủi ro đã ghi"
├─ Doanh số tăng nhưng biên hoặc thu tiền xấu → ★ "Tăng trưởng chưa chuyển thành chất lượng lợi nhuận/dòng tiền"
├─ Bán chậm, lấp đầy giảm hoặc lãi vay tăng → ★ "Áp lực hoạt động và vốn; phân biệt theo phân khúc"
└─ Thiếu hoặc kết quả hỗn hợp → ★ "Chưa đủ dữ liệu kết luận toàn diện; nêu riêng điểm đã xác minh"

## Chỉ báo đặc thù ngành

Bảng chỉ báo BĐS + cách đọc từng chỉ số ở `references/kpi.md`.

## Định giá theo đặc thù ngành

BĐS định giá bằng **P/B lấy chiết khấu so giá trị sổ sách làm trung tâm** và
**P/E trên lợi nhuận dự phóng từ backlog có phương pháp rõ**, không chỉ P/E theo lãi đã nhận — doanh thu
BĐS nhận theo đợt bàn giao nên P/E nhảy theo tiến độ. Không chia giá cho doanh thu backlog để gọi là P/E; lợi nhuận dự phóng cần biên, tiến độ và thuế có căn cứ. P/E phải ghi rõ **có bao nhiêu doanh thu chưa ghi nhận** đi kèm. Neo kỳ vọng bằng `planned_targets` (kế
hoạch bán trước/bàn giao) và `analyst_consensus`. So sánh **trong cùng phân
khúc**: so P/B nhà ở với công nghiệp là vô nghĩa.

## Rủi ro đặc thù

- **Rủi ro tái cấu trúc**: tường đáo hạn trái phiếu + lãi phát hành tăng là rủi ro
  đầu tiên của ngành, xuất hiện trước khi doanh thu giảm.
- **Rủi ro đòn bẩy pháp định**: vượt trần nợ theo quy mô dự án thì phải huy động
  vốn chủ hoặc chậm tiến độ, cả hai đều làm giảm tăng trưởng.
- **Rủi ro cung – cầu**: cung mới đổ về cùng kỳ làm giảm khả năng tính giá → biên
  lãi gộp giảm dù doanh thu tăng.
- **Rủi ro tiến độ phê duyệt**: phụ thuộc bảng giá đất công bố định kỳ và chuỗi
  phê duyệt; chậm một bước làm chi phí tài chính đội lên.
- **Rủi ro khác biệt phân khúc**: đọc một con số "ngành BĐS" sẽ lỗi khi nhà ở và
  công nghiệp đi ngược chiều.

## Ranh giới

- Không xác định pha thị trường, không bảo "BĐS sắp dẫn sóng" hay "cuối sóng" →
  `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán, không đặt tỷ trọng → `phan-tich-chuyen-sau-1-ma`.
- Không suy ngưỡng pháp lý từ trí nhớ: trần nợ, bảng giá đất, quy định nhà ở phải
  tra văn bản hiện hành rồi ghi nguồn + ngày văn bản (luật này chỉ nằm ở đây).
- Không đọc doanh thu BĐS như hàng tiêu dùng đều đặn: nhận theo đợt bàn giao, đọc
  kèm tích luỹ chi phí dở.

## Giới hạn

- Dư nợ tín dụng và tường đáo hạn trái phiếu là số ngành, độ trễ theo kỳ; ghi rõ
  đang dùng số kỳ nào.
- Phân khúc không rõ ràng ở nhiều doanh nghiệp niêm yết (mảng BĐS trộn dịch vụ,
  bán lẻ): ghi rõ phân khúc nào đang đọc.
- Biên lãi gộp nhà ở có thể nhảy mạnh do một dự án bàn giao — đọc 4 quý trước khi
  kết luận xu hướng.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chủ đầu tư BĐS có bị siết vốn không?
Đạt khi: có dư nợ tín dụng ngành + nguồn, nợ vay/trái phiếu/vốn chủ của mã, tường
đáo hạn, biên lãi gộp mảng BĐS, và verdict theo cây Q1→Q5 ghi rõ phân khúc nào.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
waterfall từ bán trước → doanh thu chưa ghi nhận → doanh thu nhận, multiline
chi phí lãi thuần/tổng nợ của nhóm, bar mức đòn bẩy và tích luỹ chi phí. Vẽ bằng
`chart_render` với `from_call` (mã `[ref …]`) từ kết quả `financial_detail`/
`peer_compare` đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc bán trước, doanh thu chưa ghi nhận, tích luỹ chi phí, biên lãi gộp và cách tính đòn bẩy theo trần quy định |
