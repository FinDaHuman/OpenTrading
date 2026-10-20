---
name: bat-dong-san-vn
description: "Phân tích ngành bất động sản VN theo dòng vốn và pháp lý: tín dụng ngành, kênh trái phiếu và tường đáo hạn, trần nợ theo quy định, cơ cấu nhà ở so khu công nghiệp. Dùng khi hỏi xu hướng nhóm BĐS hay đọc BCTC chủ đầu tư."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, analyst_consensus, peer_compare, financial_ratios, stock_overview, news_symbol, news_market, company_events, event_calendar_vn, dividends_splits, symbol_lookup, vn_company]
triggers:
  keywords: [bất động sản, nhóm bất động sản, chủ đầu tư, bán trước, căn hộ, khu công nghiệp, nhà ở thương mại, bất động sản công nghiệp, dòng tiền bất động sản, doanh nghiệp bất động sản]
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
| Kênh trái phiếu + tường đáo hạn | Phát hành trái phiếu tăng nhanh đổi lấy rủi ro tái cấu trung hạn: tường đáo hạn tập trung vài quý là điểm nghẽn. Lãi phát hành tăng = thị trường phát giá rủi ro ngành cao hơn | Phát hành + lãi + tường đáo hạn: `news_market`/`web_search`; riêng mã đọc trái phiếu phát hành trong `financial_detail` |
| Rào pháp lý | Quy định giới hạn (vay ngân hàng + trái phiếu)/vốn chủ theo quy mô dự án làm trần đòn bẩy của cả ngành; Luật Đất đất định kỳ công bố bảng giá đất (+ quy định thay thế khác) đổi chi phí đầu vào | Nội dung văn bản + hiệu lực: `news_market`/`web_search`. **Không suy ngưỡng mới** — tra văn bản hiện hành rồi ghi nguồn |
| Phân khúc | Nhà ở thương mại: lãi vay + khả năng hấp thụ + cung mới. Công nghiệp: dòng vốn nước ngoài + giá thuê + hấp thụ đất. Hai chu kỳ khác chiều được | Bán trước/bàn giao và giá thuê/hấp thụ: `news_market`/`web_search`; riêng mã trong `financial_detail` và `planned_targets` |
| Thanh khoên thị trường | Cung mới đổ về cùng lúc làm giảm khả năng tính giá → biên lãi gộp mảng BĐS bị nén dù doanh thu tăng | Biên lãi gộp mảng BĐS: `financial_detail` |
| Kỳ vọng + phê duyệt | Dự án phải qua chuỗi phê duyệt; kỳ vọng chững lại làm tiến độ chậm và chi phí tài chính đội lên | Tiến độ + sự kiện phê duyệt: `company_events` · `event_calendar_vn` |

## Các bước

**Bước 1: Nhận diện mã + phân khúc (song song).**

`symbol_lookup` · `vn_company` (bảng mảng kinh doanh: nhà ở / công nghiệp / bán lẻ
/ dịch vụ). Thiếu phân khúc rõ → ghi "chưa rõ phân khúc", đọc cả hai nhánh cây.

**Bước 2: Dòng vốn + trần nợ (song song).**

`financial_detail`: nợ vay, trái phiếu phát hành, vốn chủ, chi phí lãi thuần.
`news_market`: dư nợ tín dụng ngành, phát hành trái phiếu ngành, tường đáo hạn.

**Bước 3: Chất lượng bán hàng + tiến độ (song song).**

`financial_detail`: bán trước (ký), doanh thu chưa ghi nhận, tích luỹ chi phí dở,
biên lãi gộp mảng BĐS. `planned_targets`: kế hoạch năm làm neo kỳ vọng.

**Bước 4: Riêng phân khúc + vị thế nhóm.**

Công nghiệp: `news_market` (hấp thụ đất, giá thuê, dòng vốn nước ngoài).
Nhà ở: `news_market` (cung mới, lãi vay, chính sách nhà ở). `peer_compare`:
so biên lãi gộp, đòn bẩy, tích luỹ chi phí trong nhóm cùng phân khúc.

## Cây quyết định doanh nghiệp đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Doanh nghiệp thuộc phân khúc nào?
├─ Nhà ở thương mại → Q2 (nhánh nhà ở)
├─ Công nghiệp / hạ tầng → Q4 (nhánh công nghiệp)
├─ Bán lẻ / dịch vụ → ★ "Chu kỳ bám tiêu dùng và tỷ lệ lấp đầy — đọc ở
   `tieu-dung-ban-le-vn` rồi quay lại đọc đòn bẩn ở Q5"
└─ Nhiều phân khúc, không có phân khúc nào > nửa lãi → Q2 và **đọc cả hai nhánh**

Q2 (nhà ở). Dòng vốn vào ngành còn chảy không?
├─ Tín dụng ngành tăng nhưng lãi vay đang cao + cung mới lớn → Q3
├─ Tín dụng siết và/hoặc lãi phát hành cao → ★ "Bị siết bởi vốn: đọc tường đáo
   hạn và chi phí lãi trước khi nhìn doanh thu"
└─ Cả tín dụng và trái phiếu đều nới → Q3

Q3 (nhà ở). Tường đáo hạn và trần nợ còn chỗ không?
├─ Đáo hạn tập trung vài quý tới HOẶC đã gần trần nợ theo quy định → ★ "Bị siết
   bởi tái cấu trúc: tiếp cận vốn đắt hoặc hạn chế, dù bán trước đẹp"
└─ Còn chỗ → ★ "Được tiếp sức bởi vốn: đọc chất lượng bán hàng (Q5) để xem tăng
   trưởng có thật không"

Q4 (công nghiệp). Dòng vốn nước ngoài và giá thuê còn kéo không?
├─ Có, hấp thụ đất và giá thuê đang tăng → Q5
└─ Không, hấp thụ chững và giá thuê phẳng → ★ "Bị siết bởi cầu: đọc quỹ đất và
   tăng trưởng cho thuê trước khi tin bán trước"

Q5 (chung). Chất lượng bán hàng có đủ sống qua giai đoạn siết không?
├─ Bán trước và doanh thu chưa ghi nhận tăng, biên lãi gộp giữ được → ★ "Được
   tiếp sức: dòng tiền đang chuyển thành doanh thu thật"
├─ Bán trước tăng nhưng biên lãi gộp giảm → ★ "Tăng trưởng bằng giá, không bằng
   đòn bẩy — hạ độ tin cậy các kỳ tăng trưởng tiếp theo"
└─ Bán trước đi ngang, chi phí lãi tăng → ★ "Bị siết: đòn bẩy cao + bán chậm là
   cấu trúc rủi ro nhất của ngành"

## Chỉ báo đặc thù ngành

Bảng chỉ báo BĐS + cách đọc từng chỉ số ở `references/kpi.md`.

## Định giá theo đặc thù ngành

BĐS định giá bằng **P/B lấy chiết khấu so giá trị sổ sách làm trung tâm** và
**P/E trên backlog chưa ghi nhận**, không chỉ P/E theo lãi đã nhận — doanh thu
BĐS nhận theo đợt bàn giao nên P/E nhảy theo tiến độ. P/E phải ghi rõ **có bao
nhiêu doanh thu chưa ghi nhận** đi kèm. Neo kỳ vọng bằng `planned_targets` (kế
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
| `references/kpi.md` | Cần cách đọc bán trước, doanh thu chưa ghi nhận, tích luỹ chi phí, biên lãi gộp và cách tính đòn bẩn theo trần quy định |
