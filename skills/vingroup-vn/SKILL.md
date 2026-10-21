---
name: vingroup-vn
description: "Đọc tập đoàn Vingroup theo từng mảng (BĐS Vinhomes, xe điện VinFast, bán lẻ Vincom…): SOTP, dòng tiền, nợ đến hạn, giao dịch liên kết. Dùng khi hỏi sức khoẻ VIC, VHM hay VinFast."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, company_events, news_symbol, news_market, web_search, financial_ratios, planned_targets, analyst_consensus, peer_compare, stock_overview, breadth_scan, symbol_lookup, vn_company]
triggers:
  keywords: [vingroup, vinfast, vinhomes, tập đoàn vingroup, hệ sinh thái vingroup, xe điện vinfast, quỹ đất vinhomes, vincom retail]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, hôm nay, bao nhiêu điểm, kéo chỉ số, kéo vn-index]
version: 1.0.0
---

# Vingroup — framework phân tích

Vingroup là **tập đoàn nhiều mảng**, không phải một ngành: bất động sản (Vinhomes), xe
điện (VinFast), bán lẻ – cho thuê (Vincom Retail), nghỉ dưỡng, giáo dục, y tế, công
nghiệp. Mỗi mảng có chu kỳ riêng và **tỷ trọng đóng góp đổi theo kỳ**: kỳ Vinhomes bàn
giao lớn thì BĐS kéo lãi, còn xe điện là biến dòng tiền vì đang cần nhiều vốn. Phạm vi
hợp nhất cũng thay đổi (tách, bán, gộp công ty con), nên số kỳ này có thể không so được
với kỳ trước.

## Khi nào dùng

- Dùng khi: hỏi sức khoẻ tài chính Vingroup hay công ty thành viên, VinFast lỗ ảnh
  hưởng tập đoàn thế nào, định giá tập đoàn theo từng mảng.
- Khi KHÔNG dùng:
  - Pha thị trường, nhóm Vin có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Tin trong ngày về Vin → `tim-kiem-tin-tuc`; Vin kéo chỉ số hôm nay bao nhiêu điểm →
    tra market movers, không cần skill.
  - Ngành BĐS nói chung → `bat-dong-san-vn`; bán lẻ nói chung → `tieu-dung-ban-le-vn`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Vòng BĐS | Lãi theo đợt bàn giao dự án; tiền khách trả trước và hàng tồn kho dự án là lãi tương lai | `financial_detail` VHM/VIC: người mua trả tiền trước, hàng tồn kho (CDKT), doanh thu – biên mảng BĐS (TM) |
| Vòng xe điện | Doanh thu tăng nhưng biên âm; lỗ và nhu cầu vốn của VinFast là biến dòng tiền của tập đoàn | Lợi nhuận theo mảng (TM), công bố VinFast và tập đoàn (`news_symbol`, `web_search`) |
| Nợ và tái cấp vốn | Tài trợ bằng vay ngân hàng, trái phiếu trong và ngoài nước; nợ đến hạn tập trung là rủi ro chính | CDKT: vay ngắn + dài hạn, tiền; TM: trái phiếu và lịch đáo hạn |
| Giao dịch liên kết, thay đổi hợp nhất | Mua bán tài sản, góp vốn, chuyển nhượng công ty con với bên liên quan làm lãi và phạm vi hợp nhất thay đổi | `company_events(symbol)`, `news_symbol(symbol)`, TM (giao dịch bên liên quan) |
| Bán lẻ, cho thuê | Giá thuê, tỷ lệ lấp đầy trung tâm thương mại — dòng tiền đều nhất của nhóm | `financial_detail` VRE |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `vn_company` · `financial_detail(symbol, statement=TM)` (lợi
nhuận theo mảng, giao dịch bên liên quan) · `company_events(symbol)`. Ghi rõ thay đổi
phạm vi hợp nhất trong 4 kỳ gần nhất — có thay đổi thì nói số kỳ trước không so trực
tiếp được.

**Bước 2 (song song):** `financial_detail(symbol, statement=CDKT)` (vay, tiền, người mua
trả tiền trước, hàng tồn kho) · `financial_detail(symbol, statement=KQKD)` (doanh thu,
lợi nhuận, chi phí lãi vay), 4–8 kỳ.

**Bước 3 (song song):** `web_search` (lịch đáo hạn trái phiếu, phương án huy động, số
liệu VinFast) · `news_symbol(symbol)` cho VIC/VHM/VRE (bàn giao, mở bán, giao dịch
nội bộ).

**Bước 4:** `planned_targets` · `analyst_consensus`. Khi user hỏi Vin tác động chỉ số:
tỷ trọng nhóm Vin trong VN-Index lấy từ số công bố (`web_search`, ghi nguồn + ngày);
`breadth_scan` để xem cả thị trường hay chỉ vài mã lớn kéo.

## Cây quyết định sức khoẻ tập đoàn

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Nợ đến hạn trong 4 quý tới so với tiền và nguồn huy động đã xác nhận?
├─ Vượt tiền và chưa có phương án tài trợ công bố → ★ "Bị siết bởi tái cấp vốn: đọc
│  lịch đáo hạn và phương án huy động trước khi nhìn lợi nhuận"
├─ Trong tầm tiền hoặc đã có phương án → tiếp Q2
└─ Không dựng được lịch đáo hạn → tiếp Q2, ghi rõ

Q2. Lỗ của mảng xe điện đang thu hẹp hay mở rộng?
├─ Mở rộng hoặc giữ nguyên → ★ "Xe điện vẫn hút vốn: dòng tiền tập đoàn phụ thuộc
│  bàn giao BĐS và huy động mới"
├─ Thu hẹp → tiếp Q3
└─ Không có số theo mảng → tiếp Q3, ghi rõ

Q3. Mảng BĐS có còn đủ lãi để gánh?
├─ Người mua trả tiền trước giảm, bàn giao chững → ★ "Nguồn lãi chính đang yếu đi:
│  lãi tập đoàn các kỳ tới khó giữ"
├─ Người mua trả tiền trước tăng hoặc giữ, biên giữ được → tiếp Q4
└─ Không có số → tiếp Q4

Q4. Lãi kỳ này có phần đáng kể từ giao dịch với bên liên quan hoặc chuyển nhượng
công ty con không?
├─ Có → ★ "Lãi kỳ này một phần là một lần: hạ độ tin cậy kỳ vọng lãi tương lai"
└─ Không → ★ "Sức khoẻ đo được: dòng tiền đến từ hoạt động chính, đọc giá trị từng
   mảng"

## Chỉ báo đặc thù ngành

Cách tách mảng và đọc dòng tiền ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Định giá **từng mảng cộng lại (SOTP)**: phần sở hữu trong công ty con niêm yết theo giá
thị trường (VHM, VRE), mảng chưa niêm yết theo phương pháp hợp với mảng (BĐS theo giá
trị tài sản ròng, bán lẻ cho thuê theo dòng tiền, xe điện theo giá trị thị trường nếu có
hoặc ghi "không định giá được"), trừ nợ ròng công ty mẹ, áp chiết khấu tập đoàn. Ghi rõ
mọi giả định. Không so P/E hợp nhất của VIC với công ty BĐS thuần.

## Rủi ro đặc thù

- Xe điện cần vốn lớn và lâu; lỗ kéo dài là rủi ro dòng tiền của cả tập đoàn.
- Nợ và trái phiếu đến hạn tập trung vài kỳ.
- Giao dịch với bên liên quan, thay đổi hợp nhất làm số liệu khó so qua các kỳ.
- Nhóm Vin chiếm tỷ trọng lớn trong chỉ số: biến động của nhóm làm lệch đọc toàn thị
  trường.

## Ranh giới

- Không xác định pha thị trường, không nói "nhóm Vin sắp dẫn sóng" → `dinh-vi-chu-ky-vn`
  (nơi giữ quy tắc về mảng Vin theo chu kỳ).
- Không khuyến nghị mua/bán.
- Không nêu lịch đáo hạn, phương án huy động hay tỷ trọng chỉ số từ trí nhớ: tra công
  bố, ghi nguồn + ngày (luật này chỉ nằm ở đây).
- Điều kiện vốn của dự án BĐS theo luật ngành nằm ở `bat-dong-san-vn`.

## Giới hạn

- Lợi nhuận theo mảng không phải kỳ nào cũng đủ chi tiết — ghi rõ nhánh thiếu.
- Số hợp nhất VIC khác số riêng từng công ty con: ghi rõ đang đọc số nào.

## Ví dụ

Hỏi: VinFast lỗ to thì Vingroup có sao không?
Đạt khi: có lỗ mảng xe điện kèm kỳ, nợ đến hạn so tiền, người mua trả tiền trước của
mảng BĐS, giao dịch liên kết nếu có, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột lợi nhuận theo mảng từng
kỳ, cột nợ đến hạn theo quý so với tiền, đường người mua trả tiền trước. Vẽ bằng
`chart_render` với `from_call` (mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình
thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách tách mảng, dòng BCTC theo statement, cách dựng lịch nợ và SOTP |
