---
name: dau-khi-vn
description: "Phân tích ngành dầu khí VN theo giá dầu quốc tế, tuyến vận chuyển, thay thế trữ lượng và ranh giới giữa khai thác với lọc hoá dầu. Dùng khi hỏi xu hướng nhóm dầu khí hay công ty dầu khí chịu gì."
activation: auto
requires_tools: [yf_commodities, financial_detail]
uses_tools: [yf_commodities, financial_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành dầu khí, dầu thô, khí đốt, lọc hoá dầu, giếng khoan, dự án khai thác, tỷ trọng dầu khí, giá dầu brent, công ty dầu khí]
version: 1.0.0
---

# Dầu khí Việt Nam — framework phân tích

Ngành dầu khí VN gồm **bốn vòng kinh doanh khác nhau** trong một nhãn chung: khai
thác (thượng nguồn), vận chuyển, lọc hoá dầu, và dịch vụ kỹ thuật. Nhãn chung là
bẫy: biên của khai thác phụ thuộc giá dầu, biên của lọc dầu phụ thuộc chênh lệch
tinh chế dầu thô, biên của dịch vụ phụ thuộc chi tiêu đầu tư. Skill này đọc ngành
bằng giá dầu quốc tế, **độ dài đường đi của dầu (tonne-mile)** — yếu tố làm cước
vận chuyển tăng kể cả khi lượng dầu qua kênh vận tải giảm — và năng lực thay thế
trữ lượng của công ty. Và một ranh giới cứng: **không xem ngành này là mắt xích
của chuỗi luân chuyển ngành** (đó là nhiệm vụ của skill chu kỳ).

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm dầu khí, một công ty dầu khí chịu gì từ giá dầu,
  khác nhau giữa khai thác và lọc dầu, cú sốc địa chính trị đổi gì cho ngành.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường, luân chuyển ngành, sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô quốc tế chi tiết (dự báo nguồn cung toàn cầu) → `danh-gia-vi-mo-quoc-te`.
  - Vận tải biển nói chung (container, logistics) → `van-tai-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Giá dầu thô | Hầu hết dòng thu của ngành bám giá dầu. Nhạy theo mảng vòng kinh doanh: thượng nguồn nhạy trực tiếp, lọc dầu nhạy chênh lệch tinh chế, dịch vụ nhạy ngân sách đầu tư | `yf_commodities` (WTI, Brent) theo chu kỳ; đối chiếu giá dầu trong `news_market` |
| Độ dài đường đi của dầu (tonne-mile) | Khi tuyến vận chuyển dài lên, cước tàu tăng kể cả khi tổng khối lượng dầu không đổi. Đây là driver của vòng vận chuyển, khác với driver của thượng nguồn | Tình trạng tuyến vận chuyển: `news_market`/`web_search`, ghi rõ nguồn và kỳ |
| Thay thế trữ lượng | Sản lượng hiện tại chỉ bền khi trữ lượng mới được bù đắp. Trữ lượng bù đắp thấp hơn sản lượng kéo dài = sản lượng sẽ giảm trong tương lai gần | Sản lượng + trữ lượng phát hiện mới: công bố ngành trong `news_market`/`web_search`; dư đọng chi phí thăm dò trong `financial_detail` |
| Chi tiêu đầu tư | Ngân sách E&P của tập đoàn quyết định doanh thu của vòng dịch vụ kỹ thuật, và thứ tự dự án quyết định vòng thượng nguồn | Kế hoạch đầu tư 5 năm: `news_market`/`web_search`; chỉ báo riêng mã: dự án trong `company_events` |
| Cơ cấu mảng | Cùng một nhãn ngành, biên hoàn toàn khác. Đọc nhầm vòng kinh doanh sẽ kết luận ngược | Mảng trong `financial_detail` + bảng mảng ở `vn_company` |
| Mùa vụ quốc tế | Nhu cầu theo mùa và các họp của nhóm sản xuất tạo nhịp giá; tác động đến nhịp ngành nhưng không đổi kỳ vọng dài hạn | Nhịp theo kỳ: `yf_commodities` theo chu kỳ |

## Các bước

**Bước 1: Nhận diện vòng kinh doanh (song song).**

`symbol_lookup` · `vn_company` + `financial_detail` để xác định mảng nào nuôi lãi:
thượng nguồn / lọc dầu / vận chuyển / dịch vụ. Ghi rõ vòng đang phân tích.

**Bước 2: Giá dầu + cú sốc tuyến vận chuyển (song song).**

`yf_commodities` (giá dầu theo chu kỳ) · `news_market` (trạng thái tuyến vận chuyển,
cước tàu dầu nếu liên quan, diễn biến địa chính trị).

**Bước 3: Sản lượng + trữ lượng + dự án (song song).**

`news_market` (sản lượng, trữ lượng phát hiện, dự án mới, khởi công) ·
`company_events` (sự kiện dự án của riêng mã). `financial_detail`: chi phí thăm dò,
xu hướng giá vốn.

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `analyst_consensus` · `peer_compare` (so chỉ trong **cùng vòng
kinh doanh** — so thượng nguồn với lọc dầu là vô nghĩa).

## Cây quyết định công ty dầu khí đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Công ty thuộc vòng kinh doanh nào?
├─ Thượng nguồn (khai thác) → Q2
├─ Lọc hoá dầu → ★ "Chu kỳ bám chênh lệch tinh chế và giá nguyên liệu đầu vào, không
   bám giá dầu trực tiếp — đọc chênh lệch tinh chế trước"
├─ Vận chuyển → ★ "Chu kỳ bám cước tàu và độ dài đường đi — đọc hướng cước tàu dầu
   trong `news_market`, đối chiếu tỷ trọng hợp đồng dài hạn"
├─ Dịch vụ kỹ thuật → ★ "Chu kỳ bám ngân sách đầu tư E&P — đọc kế hoạch đầu tư
   trước khi đọc giá dầu"
└─ Nhiều vòng, không có vòng nào > nửa lãi → Q2 và đọc cả các nhánh

Q2. Giá dầu đang ở phía nào so với kỳ vọng gần?
├─ Trên kỳ vọng hoặc đang lên → Q4
├─ Dưới kỳ vọng hoặc đang giảm → tiếp Q3
└─ Chưa có kỳ vọng rõ → Q4 với độ tin cậy thấp, ghi rõ

Q3. Giá dầu giảm có đi kèm cú sốc cung/tuyến không?
├─ Có, tuyến vận chuyển dài lên → ★ "Cước vận chuyển được tiếp sức: nguồn thu của
   vòng vận chuyển có thể đi ngược giá dầu — đọc riêng vòng đó"
└─ Không, cung dư → ★ "Thượng nguồn bị siết: đọc biên/tỷ lệ chi phí để xem ai chịu
   được giá thấp kéo dài"

Q4. Trữ lượng có được bù đắp không?
├─ Có, trữ lượng phát hiện mới bù đắp hoặc vượt sản lượng → Q5
└─ Không, trữ lượng phát hiện mới thấp hơn sản lượng liên tiếp → ★ "Bị siết bởi
   trữ lượng: sản lượng hiện tại đang được tiêu từ trữ lượng cũ, đọc thứ tự dự án
   mới trước khi nội suy sản lượng"

Q5. Biên có phụ thuộc một yếu tố đơn lẻ không?
├─ Phụ thuộc một dự án / một hợp đồng → ★ "Rủi ro tập trung: một yếu tố đổi chiều
   là toàn bộ dòng thu đổi chiều"
└─ Đa dạng mảng/khu vực → ★ "Được tiếp sức: cơ cấu đủ rộng để chịu một cú sốc giá"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành dầu khí + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Dầu khí định giá bằng **EV/EBITDA** (xử lý được giai đoạn thâm hụt) và **giá trị
trữ lượng** cho vòng thượng nguồn; vòng lọc dầu theo EV/EBITDA chu kỳ; vòng dịch
vụ theo tiền cảnh ngân sách đầu tư. Không dùng P/E tại đỉnh chu kỳ: cùng một P/E
có thể là đáy hoặc đỉnh tuỳ vị thế trong vòng. Neo kỳ vọng bằng `planned_targets` và
`analyst_consensus`.

## Rủi ro đặc thù

- **Rủi ro giá dầu đảo chiều**: trong nửa năm, không phải một quý.
- **Rủi ro suy giảm trữ lượng**: sản lượng hiện tại không bền khi trữ lượng không
  được bù đắp — rủi ro này chỉ hiện ra nhiều năm sau.
- **Rủi ro chuyển dịch năng lượng**: làm khó tài trợ cho dự án mới, đặc biệt thăm
  dò nước sâu.
- **Rủi ro tập trung**: một dự án hoặc một giao dịch định kỳ có thể nuôi cả năm.
- **Rủi ro đọc sai vòng kinh doanh**: nhãn ngành giấu bốn chu kỳ khác nhau.

## Ranh giới

- Không xác định pha thị trường, không xem dầu khí là mắt xích của chuỗi luân
  chuyển ngành, không suy "dầu khí sẽ theo sau nhóm X" → `dinh-vi-chu-ky-vn` (nơi
  giữ quy tắc chuỗi).
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy giá dầu kỳ vọng từ một kỳ báo cáo: dùng kỳ vọng công bố có nguồn rõ,
  ghi kỳ.
- Chỉ xếp hạng trong cùng vòng kinh doanh; so thượng nguồn với lọc dầu bị cấm.

## Giới hạn

- Giá dầu từ `yf_commodities` là theo chu kỳ tra được, không phải giá thực hiện của
  hợp đồng từng công ty — ghi rõ khi dùng.
- Trạng thái tuyến vận chuyển và cước tàu là tin có độ trễ, ghi rõ ngày nguồn.
- Sản lượng và trữ lượng là công bố không định kỳ: ghi kỳ công bố, không nội suy.

## Ví dụ

**Ví dụ 1:**
Hỏi: Giá dầu giảm thì nhóm dầu khí chịu gì?
Đạt khi: xác định được vòng kinh doanh đang hỏi, có giá dầu + nguồn, tác động đến
từng vòng theo cây Q1, và verdict ghi rõ vòng nào được tiếp sức vòng nào bị siết.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
multiline giá dầu với doanh thu mảng thượng nguồn, bar biên theo vòng kinh doanh,
waterfall từ giá dầu ra biên đơn giản. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách tách bốn vòng kinh doanh, đọc biên theo vòng và chỉ báo trữ lượng – sản lượng |
