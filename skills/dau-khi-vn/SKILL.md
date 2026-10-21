---
name: dau-khi-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành dầu khí VN theo giá dầu quốc tế, tuyến vận chuyển, thay thế trữ lượng và ranh giới giữa khai thác với lọc hoá dầu. Dùng khi hỏi xu hướng nhóm dầu khí hay công ty dầu khí chịu gì."
activation: auto
requires_tools: [yf_commodities, financial_detail]
uses_tools: [yf_commodities, financial_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [nhóm dầu khí, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, giá dầu Brent hôm nay, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [nhóm dầu khí, ngành dầu khí, khai thác dầu khí, chi phí khí đầu vào, lọc hoá dầu, giếng khoan, dự án khai thác, tỷ trọng dầu khí, tác động giá dầu, công ty dầu khí]
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

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định công ty dầu khí đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Mảng nào nuôi lợi nhuận công ty?
├─ Thượng nguồn → tiếp Q2
├─ Lọc hóa dầu → ★ "Đánh giá chênh lệch tinh chế, tồn kho và công suất; thiếu thì chưa đủ dữ liệu cho mảng lọc dầu"
├─ Vận chuyển → ★ "Đánh giá riêng cước tàu, tonne-mile và hợp đồng dài hạn; tuyến dài không mặc nhiên tăng lãi toàn công ty"
├─ Dịch vụ kỹ thuật → ★ "Đánh giá ngân sách E&P, backlog và tiến độ nghiệm thu; thiếu thì chưa đủ dữ liệu mảng dịch vụ"
├─ Nhiều mảng → phân tích độc lập từng mảng theo Q1, sau đó tổng hợp theo tỷ trọng lợi nhuận công bố
└─ Chưa rõ cơ cấu → ★ "Chưa đủ dữ liệu phân mảng; không dùng giá dầu đại diện cả công ty"

Q2. Giá dầu so với giá thực hiện và kỳ vọng có nguồn ra sao?
├─ Cao hơn hoặc tăng → ghi thuận lợi cho thượng nguồn, tiếp Q3
├─ Thấp hơn hoặc giảm → ghi áp lực thượng nguồn, tiếp Q3
└─ Chưa có kỳ vọng/giá thực hiện → ghi thiếu, tiếp Q3

Q3. Sản lượng và trữ lượng có được duy trì không?
├─ Sản lượng ổn/tăng, trữ lượng bù đắp được xác nhận → ghi thuận lợi, tiếp Q4
├─ Trữ lượng suy giảm hoặc dự án bù sản lượng trễ → ghi áp lực đã xác minh, tiếp Q4
└─ Chưa công bố → ghi thiếu trữ lượng/sản lượng, tiếp Q4

Q4. Biên và mức tập trung có xác nhận khả năng chịu chu kỳ không?
├─ Biên giữ được ở giá thấp, dự án đa dạng, dữ liệu đủ → ★ "Thượng nguồn có sức chống chịu; nêu điều kiện về giá và sản lượng"
├─ Biên giảm hoặc phụ thuộc một dự án/hợp đồng → ★ "Thượng nguồn chịu áp lực hoặc tập trung rủi ro theo bằng chứng; không suy lợi ích từ cước tàu"
└─ Chưa có dữ liệu/không đồng kỳ → ★ "Chưa đủ dữ liệu kết luận thượng nguồn; tách rõ tín hiệu giá đã biết"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành dầu khí + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Dầu khí định giá bằng **EV/EBITDA** (chỉ khi EBITDA dương và có thể so sánh; EBITDA không dương thì không diễn giải bội số, chuyển sang dòng tiền chuẩn hóa hoặc tài sản) và **giá trị
trữ lượng** cho vòng thượng nguồn; vòng lọc dầu theo EV/EBITDA chu kỳ; vòng dịch
vụ theo triển vọng ngân sách đầu tư. Không dùng P/E tại đỉnh chu kỳ: cùng một P/E
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
