---
name: vingroup-vn
description: "Phân tích tập đoàn Vingroup theo giá trị tách rời từng mảng, vòng quay tiền mặt, đòn bẩy so với trần nợ và tỷ trọng của nhóm Vin trong chỉ số. Dùng khi hỏi tập đoàn Vingroup, Vinhomes, VinFast hay Vincom Retail."
activation: auto
requires_tools: [financial_detail, company_events]
uses_tools: [financial_detail, company_events, news_symbol, news_market, financial_ratios, planned_targets, analyst_consensus, peer_compare, market_overview, event_calendar_vn, symbol_lookup, vn_company, vs_industry_tree]
triggers:
  keywords: [vingroup, vinfast, vinhomes, vincom, vinpearl, nhóm vin, tập đoàn vingroup, tossanholding, quỹ đất vinhomes, xe điện vinfast, bán lẻ vincom]
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
   đọc bán trước và tích luỹ chi phí dở, không đọc một quý.
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
| Vòng quay BĐS | Lãi đến từ bàn giao dự án Vinhomes. Bán trước là khoản thu trước, tích luỹ chi phí dở là chi phí đã cam kết chưa nhận — chênh lệch hai bên là lãi tương lai | `financial_detail` (bán trước, tích luỹ chi phí dở, biên mảng BĐS) |
| Vòng xe điện | Doanh thu xe điện tăng nhưng biên âm; tỷ lệ hoàn vốn phụ thuộc quy mô và chi phí/biến. Tái cấu trúc (tách, bán, gộp mảng) đổi pháp nhân báo cáo | Mảng xe điện + lỗ lũy kế + tái cấu trúc: `financial_detail`, `company_events` |
| Đòn bẩy | Tài trợ dự án bằng nợ và trái phiếu; tường trái phiếu và chi phí vốn bình quân quyết định rủi ro tái cấp | `financial_detail` (nợ, trái phiếu, lãi) + `news_market` (tường đáo hạn, phát hành) |
| Giao dịch liên kết | Mua bán tài sản nội bộ và loại trừ bàn giao làm thay đổi cả cơ cấu hợp nhất lẫn biên | `company_events` (đợt thay đổi cơ cấu) + `news_market` |
| Tỷ trọng chỉ số | Nhóm Vin chiếm tỷ trọng lớn vốn hoá và thanh khoản chỉ định; biến động nhóm một mình có thể kéo cả chỉ số → rủi ro tập trung danh mục | Tỷ trọng + độ rộng chỉ số: `market_overview` · `news_market` · `vs_industry_tree` |
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

`market_overview` (độ rộng, tỷ trọng nhóm lớn nếu có) · `news_market` (nhận định về
ảnh hưởng chỉ số) · `planned_targets` · `peer_compare` · `analyst_consensus`.

## Cây quyết định sức khoẻ tập đoàn

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Cơ cấu hợp nhất vừa thay đổi chưa (tách, thoái, gộp mảng)?
├─ Có → ★ "Con số kỳ này không so được với kỳ trước: đọc chênh lệch pháp nhân trước,
   rồi mới đọc xu hướng"
└─ Không → tiếp Q2

Q2. Mảng BĐS có còn dẫn lãi không?
├─ Có, bán trước + biên mảng BĐS đang tăng → tiếp Q3
└─ Không, mảng BĐS chững hoặc biên giảm → ★ "Bánh lái đang chuyển khỏi BĐS: đọc
   mảng nào sẽ kế nghiệp trước khi nội suy lãi"

Q3. Mảng xe điện đốt tiền mặt ở mức nào?
├─ Đang thu hẹp lỗ (biên cải thiện, chi phí/biến giảm) → tiếp Q4
└─ Lỗ giữ nguyên hoặc mở rộng → ★ "Đốt tiền mặt chưa dừng: đọc nhu cầu tái cấp và
   dòng tiền tổng thể — mảng này là rủi ro dòng tiền của cả tập đoàn"

Q4. Tái cấp vốn có chắc chắn không?
├─ Có, nợ đến hạn xa hoặc đã có phương án tài trợ → tiếp Q5
└─ Chưa, tường trái phiếu gần + chi phí vốn cao → ★ "Bị siết bởi tái cấu: đọc lịch
   đáo hạn và phương án huy động trước khi nhìn lãi"

Q5. Giao dịch liên kết có làm lệch báo cáo không?
├─ Không đáng kể → ★ "Sức khoẻ đo được: đọc giá trị từng mảng và dòng tiền"
└─ Có, giao dịch nội bộ chiếm tỷ trọng lớn trong kỳ → ★ "Lãi kỳ này một phần đến từ
   giao dịch nội bộ: đánh dấu một lần, hạ độ tin cậy kỳ vọng lãi tương lai"

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
