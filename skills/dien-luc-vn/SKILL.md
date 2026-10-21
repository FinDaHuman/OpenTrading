---
name: dien-luc-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành điện Việt Nam theo cải cách giá điện, cơ cấu nguồn, thủy văn và kế hoạch phát triển lưới. Dùng khi hỏi xu hướng nhóm điện, đọc kết quả nhà máy điện hay tác động giá điện."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, company_events, symbol_lookup, vn_company, vn_forex_ohlcv]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành điện, phát điện, tác động giá điện, thủy điện, nhiệt điện, sản lượng điện, kế hoạch phát triển điện lực, lưới điện truyền tải, nhà máy điện, chi phí phát điện]
version: 1.0.0
---

# Điện lực Việt Nam — framework phân tích

Ngành điện VN có **một điểm cấu trúc quyết định mọi phần còn lại**: phần lớn dòng thu nhà máy dựa vào hợp đồng mua bán điện với bên mua điện; phải xác minh cơ chế hợp đồng và mua bán điện trực tiếp áp dụng cho từng dự án. Vì vậy biến then chốt là **cơ chế giá điện và hợp đồng**, cùng nhu cầu/huy động thực tế: giá bán lẻ không bù đủ chi phí có thể tạo áp lực tài chính cho bên mua và rủi ro thanh toán. Điều chỉnh giá có thể giảm áp lực nhưng vẫn phải kiểm tra thu tiền thực tế của nhà máy. Kỳ vọng tăng trưởng nhu cầu mà bỏ qua biến này sẽ đọc sai cả ngành.

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
| Giá điện và cải cách giá bán lẻ | Phần lớn nhà máy bán điện theo hợp đồng với bên mua điện; xác minh cả cơ chế mua bán trực tiếp nếu áp dụng. Giá bán lẻ không đủ chi phí có thể gây áp lực tài chính và thanh toán; điều chỉnh giá cần được xác nhận bằng công nợ và dòng tiền thực tế. Đây là biến re-rate ngành | Khung giá và cơ chế điều chỉnh: `news_market`/`web_search`, ghi văn bản + ngày. Công nợ nhà máy với mua bán: `financial_detail` |
| Cơ cấu nguồn | Cơ cấu phát điện theo loại nguồn quyết định nhóm nào được ưu tiên khai thác. Nước sụt giảm làm tăng tỷ trọng nhiệt điện chạy bù | Cơ cấu phát điện theo kỳ: `news_market` (báo cáo ngành), nếu không có thì `web_search` có nguồn |
| Thủy văn | Mực nước hồ chứa quyết định sản lượng thủy điện và thứ tự khai thác chạy bù. Mùa khô kéo dài làm nhóm thủy điện bị hạ định giá trong nhiều kỳ | Mực nước/vận hành hồ chứa: `news_market`, ghi kỳ và vùng miền |
| Kế hoạch phát triển lưới | Quyết định quy mô công suất và dự phòng công suất tương lai; điều chỉnh quy hoạch thay đổi thứ tự dự án được ưu tiên vốn | Văn bản quy hoạch + điều chỉnh: `news_market`/`web_search`, ghi văn bản + ngày |
| Tải trọng mới | Tải trung tâm dữ liệu (chạy phẳng) và xe điện làm đổi hình đường cong nhu cầu: ưu tiên nguồn chạy nền và truyền tải | Kỳ vọng tải mới: `news_market`/`web_search` |
| Nhiên liệu đầu vào | Than, khí nhập khẩu và tỷ giá quyết định chi phí vùng phát nhiệt; khí nhập nhạy tỷ giá mạnh hơn than nội địa | Khí tự nhiên tham chiếu: `yf_commodities`; than nhiệt/LNG và giá hợp đồng: `web_search` nguồn công bố có ngày, đơn vị và chủng loại; tỷ giá: `vn_forex_ohlcv` nếu cần bối cảnh |

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
`company_events` (sự kiện dự án của riêng mã, PPA mới) · `yf_commodities` (khí tự nhiên tham chiếu; than nhiệt/LNG tra nguồn công bố qua `web_search`, không giả định có trong bộ COMMO mặc định).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `analyst_consensus` · `peer_compare` (so trong cùng nhóm
nguồn — luật ở §Ranh giới, không lặp lại ở đây).

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định nhà máy điện đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Công ty thuộc nhóm nguồn nào?
├─ Thủy điện → Q3 (thủy)
├─ Khí/LNG hoặc than → Q2 (nhiệt)
├─ Tái tạo → ghi cơ chế PPA, cắt giảm công suất và khả năng đấu nối, tiếp Q4
├─ Truyền tải/thiết bị → ★ "Đánh giá đầu tư lưới, backlog và hợp đồng; thiếu thì chưa đủ dữ liệu mảng thiết bị"
├─ Nhiều nguồn → đánh giá riêng mỗi nguồn theo Q1 rồi tổng hợp theo tỷ trọng công bố
└─ Chưa rõ cơ cấu → ★ "Chưa đủ dữ liệu phân nguồn; không chọn một nguồn đại diện"

Q2 (nhiệt). Giá hợp đồng và nhiên liệu có cho phép phát điện có lãi không?
├─ Có cơ chế chuyển chi phí/giá hợp đồng phù hợp → ghi thuận lợi, tiếp Q5
├─ Nhiên liệu tăng nhưng giá chưa bù, có bằng chứng → ghi áp lực biên, tiếp Q5
└─ Chưa rõ PPA/giá nhiên liệu thực hiện → ghi thiếu, tiếp Q5

Q3 (thủy). Thủy văn và sản lượng đang thế nào?
├─ Lưu lượng nước/sản lượng thuận lợi → ghi thuận lợi, tiếp Q4
├─ Hồ thấp/sản lượng giảm được xác nhận → ghi áp lực thủy văn, tiếp Q4
└─ Chưa có dữ liệu theo vùng/kỳ → ghi thiếu, tiếp Q4

Q4 (chung). Dòng tiền và công nợ có xác nhận doanh thu không?
├─ Thu tiền đúng hạn, biên/sản lượng xác nhận trạng thái thuận lợi → ★ "Được tiếp sức trong nguồn đang phân tích"
├─ Phải thu tăng và có bằng chứng thanh toán chậm hoặc biên giảm → ★ "Có áp lực dòng tiền/biên; xác minh nguyên nhân, không mặc định do giá bán lẻ"
└─ Dữ liệu thiếu hoặc trái chiều → ★ "Chưa đủ dữ liệu kết luận tổng thể; nêu tín hiệu nguồn và công nợ đã biết"

Q5 (nhiệt). Khả năng được huy động và chi phí biến đổi ra sao?
├─ Sản lượng huy động tăng, chi phí hợp đồng kiểm soát được → ghi thuận lợi, tiếp Q4
├─ Huy động thấp do chi phí biến đổi, ràng buộc lưới hoặc hợp đồng → ghi áp lực có nguyên nhân, tiếp Q4
└─ Chưa rõ thứ tự huy động/sản lượng → ghi thiếu, tiếp Q4

Dự phòng công suất là độ dư công suất khả dụng so với phụ tải đỉnh; thứ tự huy động phụ thuộc chi phí biến đổi, ràng buộc kỹ thuật, lưới và hợp đồng. Không dùng dự phòng cao để tự kết luận một nhà máy bị giảm huy động.

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
- **Rủi ro huy động**: dự phòng công suất cao tạo cạnh tranh, nhưng sản lượng từng nhà máy còn phụ thuộc chi phí biến đổi, lưới, kỹ thuật và hợp đồng.
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
stacked bar cơ cấu nguồn theo kỳ, multiline sản lượng/giá vốn theo nhóm, scatter phải
thu so với doanh thu. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết
quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách phân nhóm nguồn, đọc phải thu với người mua bán điện, và chỉ báo sản lượng/biên theo nhóm |
