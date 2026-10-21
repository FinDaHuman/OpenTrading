---
name: dien-luc-vn
description: "Phân tích ngành điện Việt Nam theo cải cách giá điện, cơ cấu nguồn, thủy văn và kế hoạch phát triển lưới. Dùng khi hỏi xu hướng nhóm điện, đọc kết quả nhà máy điện hay tác động giá điện."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, company_events, symbol_lookup, vn_company, vn_forex_ohlcv]
triggers:
  keywords: [ngành điện, phát điện, giá điện, thủy điện, nhiệt điện, sản lượng điện, kế hoạch phát triển điện lực, lưới điện truyền tải, nhà máy điện, nguyên giá điện]
version: 1.0.0
---

# Điện lực Việt Nam — framework phân tích

Ngành điện VN có **một điểm cấu trúc quyết định mọi phần còn lại**: toàn bộ dòng
thu của nhà máy chảy qua một người mua duy nhất (tập đoàn điện quốc gia qua công
ty mua bán điện). Vì vậy biến then chốt **không phải tăng trưởng nhu cầu** mà là
**cải cách giá điện**: khi giá bán lẻ giữ dưới giá thành, tập đoàn lỗ và trả chậm
tiền cho nhà máy; khi điều chỉnh đúng chi phí, cả chuỗi được trả đúng hạn và nhanh
hơn. Kỳ vọng tăng trưởng nhu cầu mà bỏ qua biến này sẽ đọc sai cả ngành.

Yếu tố thứ hai: **loại nguồn**. Thủy điện, khí, than và thiết bị lưới nằm trong
bốn chu kỳ hoàn toàn khác nhau, và thủy văn (mực nước hồ) quyết định nhóm nào bị
hạ định giá trong mùa khô.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm điện, một nhà máy điện chịu gì, giá điện điều
  chỉnh tác động ra sao, thủy văn hại nhóm nào.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết → `danh-gia-vi-mo-viet-nam`.
  - Khu công nghiệp (bất động sản công nghiệp nói chung) → `bat-dong-san-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Giá điện và cải cách giá bán lẻ | Toàn bộ dòng thu ngành qua một mua một bán duy nhất. Giá bán lẻ không đủ chi phí → tập đoàn điện lỗ và kéo dài công nợ với nhà máy; điều chỉnh đủ → cả chuỗi được trả nhanh hơn. Đây là biến re-rate ngành | Khung giá và cơ chế điều chỉnh: `news_market`/`web_search`, ghi văn bản + ngày. Công nợ nhà máy với mua bán: `financial_detail` |
| Cơ cấu nguồn | Cơ cấu phát điện theo loại nguồn quyết định nhóm nào được ưu tiên khai thác. Nước sụt giảm làm tăng tỷ trọng nhiệt điện chạy bù | Cơ cấu phát điện theo kỳ: `news_market` (báo cáo ngành), nếu không có thì `web_search` có nguồn |
| Thủy văn | Mực nước hồ chứa quyết định sản lượng thủy điện và thứ tự khai thác chạy bù. Mùa khô kéo dài làm nhóm thủy điện bị hạ định giá trong nhiều kỳ | Mực nước/vận hành hồ chứa: `news_market`, ghi kỳ và vùng miền |
| Kế hoạch phát triển lưới | Quyết định quy mô công suất và trữ thặng dư tương lai; điều chỉnh quy hoạch thay đổi thứ tự dự án được ưu tiên vốn | Văn bản quy hoạch + điều chỉnh: `news_market`/`web_search`, ghi văn bản + ngày |
| Tải trọng mới | Tải trung tâm dữ liệu (chạy phẳng) và xe điện làm đổi hình đường cong nhu cầu: ưu tiên nguồn chạy nền và truyền tải | Kỳ vọng tải mới: `news_market`/`web_search` |
| Nhiên liệu đầu vào | Than, khí nhập khẩu và tỷ giá quyết định chi phí vùng phát nhiệt; khí nhập nhạy tỷ giá mạnh hơn than nội địa | Giá than/khí: `yf_commodities`; tỷ giá: `vn_forex_ohlcv` nếu cần bối cảnh |

## Các bước

**Bước 1: Nhận diện nhóm nguồn (song song).**

`symbol_lookup` · `vn_company` (mảng: thủy / khí / nhiệt / tái tạo / truyền tải /
thiết bị) · `financial_detail` (doanh thu theo mảng nếu có). Ghi rõ nhóm nguồn
đang phân tích.

**Bước 2: Giá điện + công nợ (song song).**

`financial_detail` (doanh thu, các khoản phải thu — phải thu người mua bán điện là
chỗ chứa rủi ro chính của ngành) · `news_market` (khung giá, điều chỉnh giá bán lẻ,
cơ chế giá ưu đãi).

**Bước 3: Cơ cấu + thủy văn + dự án (song song).**

`news_market` (cơ cấu phát điện theo kỳ, tình trạng hồ chứa, tiến độ dự án) ·
`company_events` (sự kiện dự án của riêng mã, PPA mới) · `yf_commodities` (giá
nhiên liệu đầu vào nếu nhóm nhiệt).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `analyst_consensus` · `peer_compare` (so trong cùng nhóm
nguồn — luật ở §Ranh giới, không lặp lại ở đây).

## Cây quyết định nhà máy điện đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Công ty thuộc nhóm nguồn nào?
├─ Thủy điện → Q3 (nhánh thủy)
├─ Khí / LNG → Q2 rồi Q4 (nhánn khí: giá điện + nhiên liệu nhập)
├─ Nhiệt điện (than) → Q2 rồi Q5 (nhánh nhiệt: giá điện + tỷ trọng khai thác)
├─ Truyền tải / thiết bị → ★ "Chu kỳ bám chi tiêu đầu tư lưới và quy hoạch — đọc
   kế hoạch phát triển lưới và hợp đồng thi công thay vì giá điện"
└─ Nhiều nhóm, không có nhóm nào > nửa lãi → đọc cả các nhánh liên quan

Q2. Giá điện có được điều chỉnh theo chi phí không?
├─ Có, điều chỉnh gần đây theo hướng đủ chi phí → tiếp Q4
├─ Giữ nguyên trong khi chi phí đầu vào tăng → ★ "Bị siết bởi giá: biên bị bóp
   không kể cơ cấu nguồn — đọc công nợ với người mua bán điện để xem mức độ"
└─ Chưa rõ cơ chế → tiếp Q4 với độ tin cậy thấp

Q3 (thủy). Thủy văn đang thuận hay nghịch?
├─ Thuận (mực nước/lưu lượng tốt) → Q4
└─ Nghịch (mùa khô kéo dài, hồ thấp) → ★ "Bị siết bởi thủy văn: sản lượng thấp
   trong nhiều kỳ, đọc xu hướng mực nước trước khi kỳ vọng phục hồi"

Q4 (chung). Dòng tiền có đến đúng hạn không?
├─ Phải thu với người mua bán điện ổn hoặc giảm → Q5
└─ Phải thu tăng nhanh hơn doanh thu → ★ "Bị siết bởi giá bán lẻ phía sau: giá
   bán không đủ chi phí đang được đẩy sang công nợ nhà máy"

Q5 (nhiệt / chung). Vị thế trong trữ thặng dư và đầu vào?
├─ Được ưu tiên khai thác + chi phí đầu vào giảm → ★ "Được tiếp sức: tỷ trọng
   khai thác và chi phí cùng chiều"
├─ Không được ưu tiên (thặng dư đủ, nguồn rẻ ưu tiên trước) → ★ "Bị siết bởi trữ
   thặng dư: khai thác thấp trong khi chi phí cố định vẫn chạy"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành điện + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Điện định giá **theo nhóm nguồn**, không có một cặp multiple cho cả ngành: nhóm
nhiệt trong mùa khô và nhóm thủy điện trong cùng kỳ là hai chu kỳ khác nhau. Dùng
P/E và P/B trong **cùng nhóm nguồn** (luật so sánh ở §Ranh giới), kèm dòng tiền từ
phải thu để đánh giá chất lượng doanh thu. Neo kỳ vọng bằng `planned_targets` (kế hoạch sản
lượng/doanh thu) và `analyst_consensus`. Nhà máy trong giai đoạn chưa ký hợp đồng
mua bán điện: ghi rõ là dòng thu chưa chắc chắn.

## Rủi ro đặc thù

- **Rủi ro giá điện đứng**: giá bán lẻ không đủ chi phí kéo dài → thu nhập bị chuyển
  thành công nợ.
- **Rủi ro thủy văn**: mùa khô kéo dài hạ định giá nhóm thủy điện nhiều kỳ liền.
- **Rủi ro nhiên liệu nhập khẩu**: khí nhập và tỷ giá quyết định chi phí vùng khí.
- **Rủi ro trữ thặng dư**: trữ thặng dư đủ thì tỷ trọng khai thác nhiệt giảm.
- **Rủi ro văn bản hóa**: dự án chưa ký hợp đồng mua bán thì dòng thu chưa chắc
  chắn, dù hạ tầng đã xong.

## Ranh giới

- Không xác định pha thị trường, không bảo "điện sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy ngưỡng giá hoặc kỳ vọng điều chỉnh từ trí nhớ: tra văn bản hiện hành,
  ghi nguồn và ngày.
- Chỉ xếp hạng trong cùng nhóm nguồn; so thủy điện với nhiệt điện bị cấm.

## Giới hạn

- Cơ cấu phát điện và mực nước hồ là công bố theo kỳ của ngành, độ trễ 1–2 tháng.
- Cải cách giá điện là quá trình nhiều bước: kết luận giai đoạn phải ghi mốc văn bản
  đang áp dụng.
- Công nợ với người mua bán điện không công bố riêng ở mọi kỳ: khi thiếu, hạ độ tin
  cậy nhánh Q4.

## Ví dụ

**Ví dụ 1:**
Hỏi: Nhóm thủy điện đang bị siết vì đâu?
Đạt khi: có cơ cấu phát điện + nguồn, tình trạng thủy văn, phải thu với người mua
bán, và verdict theo cây Q1→Q3 ghi rõ nhóm nguồn.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
pile cơ cấu nguồn theo kỳ, multiline sản lượng/giá vốn theo nhóm, scatter phải
thu so với doanh thu. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết
quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách phân nhóm nguồn, đọc phải thu với người mua bán điện, và chỉ báo sản lượng/biên theo nhóm |
