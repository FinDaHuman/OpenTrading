---
name: vingroup-vn
description: "KPI nhóm Vin; pha/sóng dùng skill chu kỳ. SOTP VIC: Vinhomes bàn giao, VinFast đốt tiền, Vincom cho thuê; kiểm tra giao dịch liên kết, tái cấp vốn và trọng số chỉ số Vingroup."
activation: auto
requires_tools: [financial_detail, company_events]
uses_tools: [financial_detail, company_events, news_symbol, news_market, financial_ratios, planned_targets, analyst_consensus, peer_compare, breadth_scan, market_snapshot, vn_equity_quote_batch, event_calendar_vn, symbol_lookup, vn_company]
triggers:
  keywords: [nhóm vin, tập đoàn vingroup, phân tích vingroup, sức khỏe tài chính vingroup, SOTP Vingroup, quỹ đất vinhomes, hiệu quả vinfast, dòng tiền vinfast, kinh doanh vincom, vinfast lỗ]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Vingroup — framework phân tích

Vingroup là **tập đoàn đa mảng**, không phải một ngành: lãi đến từ nhiều mảng với
chu kỳ khác nhau (bất động sản, xe điện, bán lẻ, khách sạn, dịch vụ) và **tỷ trọng
mỗi mảng thay đổi theo kỳ** — kỳ nào mảng BĐS bàn giao thì BĐS dẫn, kỳ nào xe điện
mở rộng thì nó là biến số dòng tiền. Đọc VIC bằng bộ chỉ báo ngành nào cũng sai.
Skill này phân tích bằng cách **tách giá trị theo mảng và theo dòng tiền thật**, và
bước bắt buộc đầu tiên là đo tỷ trọng đóng góp của từng mảng (`financial_detail` +
công bố công ty) trước khi kết luận bất cứ điều gì về tổng hợp:

1. **Vòng quay bất động sản**: lãi đến từ bàn giao dự án, nên lãi nhảy theo đợt —
   đọc doanh số ký bán, tiền người mua trả trước và chi phí dở dang, không đọc một quý.
2. **Mảng xe điện đốt tiền mặt**: doanh thu xe điện tăng nhanh nhưng biên âm → lỗ
   lũy kế và nhu cầu tái cấp trở thành driver của cả tập đoàn.
3. **Giao dịch liên kết**: mua/bán tài sản với cổ đông sáng lập, thoái/tách khỏi hợp
   nhất, góp vốn — thay đổi pháp nhân báo cáo. Đây là rủi ro quản trị, chỉ thấy khi
   đọc trước khi số ra.

## Khi nào dùng

- Dùng khi: user hỏi về Vingroup, VIC, VHM, VinFast, Vincom, sức khoẻ tài chính
  tập đoàn, tại sao một ngày Vin dắt cả thị trường.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`; chỉ đọc BCTC một mã → `co-ban-chuyen-sau`.
  - Ngành bất động sản nói chung → `bat-dong-san-vn`.
  - Bán lẻ tiêu dùng nói chung → `tieu-dung-ban-le-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Vòng quay BĐS | Lãi đến từ bàn giao dự án Vinhomes. Doanh số ký bán trước khác tiền người mua trả trước; chi phí dở dang là tồn kho đầu tư, chênh hai số không phải lãi tương lai | `financial_detail` (bán trước, tích luỹ chi phí dở, biên mảng BĐS) |
| Vòng xe điện | Doanh thu xe điện tăng nhưng biên âm; tỷ lệ hoàn vốn phụ thuộc quy mô và chi phí/biến. Tái cấu trúc (tách, bán, gộp mảng) đổi pháp nhân báo cáo | Mảng xe điện + lỗ lũy kế + tái cấu trúc: `financial_detail`, `company_events` |
| Đòn bẩy | Tài trợ dự án bằng nợ và trái phiếu; tường trái phiếu và chi phí vốn bình quân quyết định rủi ro tái cấp | `financial_detail` (nợ, trái phiếu, lãi) + `news_market` (tường đáo hạn, phát hành) |
| Giao dịch liên kết | Mua bán tài sản nội bộ và loại trừ bàn giao làm thay đổi cả cơ cấu hợp nhất lẫn biên | `company_events` (đợt thay đổi cơ cấu) + `news_market` |
| Tỷ trọng và đóng góp chỉ số | Tỷ trọng vốn hóa sàn, trọng số chỉ số và đóng góp điểm là ba đại lượng khác nhau | Lấy trọng số thành viên theo phương pháp chỉ số, ngày cơ sở và biến động giá cùng chỉ số/cùng kỳ từ đơn vị quản lý chỉ số hoặc nguồn báo cáo có thể kiểm chứng. Không dùng quote VN30 hoặc quote batch để suy vốn hóa sàn/trọng số |
| Dòng tiền / thanh khoản | Kiểm soát độc lập: tiền mặt, vốn điều lệ, nợ đến hạn | `financial_detail` (tiền, vốn, nợ ngắn hạn) |

## Các bước

**Bước 1: Tách mảng + cơ cấu hợp nhất (song song).**

`symbol_lookup` · `vn_company` (mảng, tỷ trọng doanh thu/lãi) · `financial_detail`
(doanh thu và biên theo mảng). Ghi rõ phần nào mới thay đổi cơ cấu hợp nhất.

**Bước 2: Vòng quay BĐS (song song).**

`financial_detail`: bán trước, tích luỹ chi phí dở, biên lãi gộp mảng BĐS.
`company_events` + `news_market`: tiến độ bàn giao dự án, sự kiện phê duyệt.

**Bước 3: Vòng xe điện + đòn bẩy (song song).**

`financial_detail`: doanh thu và lỗ mảng xe điện, nợ, trái phiếu, tiền mặt,
chi phí lãi. `news_market`: tường trái phiếu đến hạn, phát hành mới, tái cấu trúc.

**Bước 4: Tác động chỉ số + neo kỳ vọng.**

`breadth_scan` (độ rộng toàn sàn) · nguồn công bố đơn vị chỉ số hoặc báo cáo
có trọng số thành viên và kỳ rõ · `planned_targets` · `peer_compare` (chỉ key tổng
quan thực trả như P/B, ROE; KPI vận hành lấy từ BCTC/công bố từng peer) · `analyst_consensus`.

Chỉ tính đóng góp khi có đầy đủ nguồn trọng số và biến động tương thích của **cùng
chỉ số, cùng kỳ**. Ước tính tỷ lệ đóng góp đơn kỳ ≈ tổng trọng số đầu kỳ × lợi suất
thành viên; đóng góp điểm ≈ mức chỉ số đầu kỳ × tỷ lệ đó, ghi rõ ước tính và điều
chỉnh theo phương pháp/divisor/tái cân bằng/sự kiện doanh nghiệp nếu cần. Nếu nguồn
công bố trực tiếp đóng góp, ưu tiên số đó. Tỷ trọng vốn hóa sàn chỉ tính khi có vốn
hóa toàn bộ phạm vi và tổng cùng thời điểm; không gọi đó là trọng số chỉ số, đặc biệt
với chỉ số điều chỉnh free-float/giới hạn tỷ trọng. Thiếu mẫu số, trọng số hoặc kỳ
thì không tính; mô tả tương quan giá/độ rộng và ghi thiếu dữ liệu.

## Cây quyết định sức khoẻ tập đoàn

Duyệt các node theo thứ tự; ghi trạng thái trung gian rồi đi tiếp. Chỉ dừng ở ★.
Thiếu dữ liệu phải ghi rõ và hạ độ tin cậy; không coi thiếu là tín hiệu xấu.

Q1. Cơ cấu hợp nhất có thay đổi không?
├─ Có → ghi cần số so sánh điều chỉnh cùng phạm vi → Q2
├─ Không → Q2
└─ Chưa xác minh → ghi hạn chế so sánh → Q2

Q2. Mảng BĐS đóng góp thế nào?
├─ Bán trước, bàn giao và biên cải thiện → ghi đóng góp BĐS thuận → Q3
├─ BĐS chững/biên giảm → ghi áp lực BĐS, chưa suy mảng khác thay thế → Q3
└─ Thiếu số theo mảng → ghi chưa rõ đóng góp → Q3

Q3. Dòng tiền mảng xe điện ra sao?
├─ Dòng tiền hoạt động và nhu cầu đầu tư cải thiện → ghi nhu cầu tài trợ giảm nếu có bằng chứng → Q4
├─ Biên/lỗ cải thiện nhưng chưa có dòng tiền → ghi chưa xác nhận giảm đốt tiền → Q4
├─ Dòng tiền âm và nhu cầu đầu tư tăng → ghi áp lực tài trợ → Q4
└─ Thiếu số → ghi chưa đo được dòng tiền xe điện → Q4

Q4. Tái cấp vốn đã được bảo đảm chưa?
├─ Nguồn cam kết có điều kiện rõ, đủ đối chiếu nợ đến hạn → ghi nguồn vốn khả dụng → Q5
├─ Thiếu hụt tiền so lịch đáo hạn → ghi rủi ro tái cấp → Q5
└─ Chưa có lịch nợ/cam kết → ghi chưa xác minh khả năng tái cấp → Q5

Q5. Giao dịch liên kết có làm méo so sánh không?
├─ Không đáng kể, đã đối chiếu loại trừ hợp nhất → ★ "Đánh giá SOTP và dòng tiền theo các trạng thái đã xác minh"
├─ Có lãi bất thường từ giao dịch/thoái vốn → ★ "Điều chỉnh lãi một lần và phạm vi hợp nhất trước khi định giá; giữ rủi ro dòng tiền đã ghi"
└─ Thiếu thuyết minh → ★ "Chưa đủ dữ liệu quản trị/hợp nhất; không kết luận lãi nội bộ đã ghi nhận ở cấp tập đoàn"

## Chỉ báo đặc thù ngành

Bảng chỉ báo tập đoàn + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Tập đoàn đa mảng **không định giá bằng một hệ số hợp nhất**: định giá bằng **giá trị
từng mảng cộng lại (SOTP)** với hệ số phù hợp từng mảng (BĐS theo P/B và NAV, xe
điện theo doanh thu/biên hoặc chiết khấu dòng tiền, bán lẻ theo P/E), rồi trừ chiết
khấu tập đoàn. Neo kỳ vọng bằng `planned_targets` và `analyst_consensus`. Không so
P/E hợp nhất với công ty BĐS thuần được.

## Rủi ro đặc thù

- **Rủi ro đa mảng**: cấu trúc lãi đổi theo mảng dẫn dắt, nên một chu kỳ duy nhất
  không mô tả được tập đoàn.
- **Rủi ro đốt tiền mặt**: mảng xe điện lỗ lũy kế thành rủi ro dòng tiền của cả tập
  đoàn.
- **Rủi ro tái cấu**: nợ và trái phiếu đến hạn tập trung vài kỳ.
- **Rủi ro quản trị**: giao dịch liên kết và thay đổi cơ cấu hợp nhất làm biên báo
  cáo và giá trị hợp nhất không so được với kỳ trước.
- **Rủi ro tập trung danh mục**: nhóm Vin chiếm tỷ trọng lớn chỉ số nên biến động
  nhóm một mình có thể làm lệch chỉ số toàn thị trường.

## Ranh giới

- Không xác định pha thị trường, không suy "nhóm Vin sắp dẫn sóng" → `dinh-vi-chu-ky-vn`
  (nơi duy nhất giữ quy tắc chuỗi và mảng Vin theo chu kỳ).
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy phương án tái cấu hoặc lịch đáo hạn từ trí nhớ: tra công bố, ghi nguồn.
- Không kết luận dòng tiền khi biên báo cáo bị giao dịch nội bộ làm lệch: đọc kỹ
  mảng nào đóng góp.

## Giới hạn

- Chi phí mảng không phải kỳ nào công ty cũng công bố đầy đủ: khi thiếu, hạ độ tin
  cậy nhánh mảng.
- Trần nợ theo quy định BĐS là luật ngành (`bat-dong-san-vn`), áp cho mảng BĐS của
  tập đoàn — không lặp lại ở đây.
- Tài trợ nội bộ giữa các công ty con làm số hợp nhất khác số riêng từng công ty:
  ghi rõ đang đọc hợp nhất hay riêng.

## Ví dụ

**Ví dụ 1:**
Hỏi: VIC có đang khoẻ không?
Đạt khi: tách được lãi theo mảng, có bán trước + tích luỹ chi phí dở, nợ + tường
đáo hạn, và verdict theo cây Q1→Q5 ghi rõ điểm cần thận trọng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
stacked doanh thu theo mảng, waterfall từ bán trước ra lãi nhận, multiline nợ/tiền
mặt theo kỳ. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết quả tool
đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc bán trước – tích luỹ chi phí dở, phân bổ lãi theo mảng và chỉ báo dòng tiền của tập đoàn |
