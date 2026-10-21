---
name: cong-nghe-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành công nghệ Việt Nam theo giá trị hợp đồng ký, phân hoá nội địa và quốc tế, đơn hàng dài hạn và tỷ lệ sử dụng nhân công. Dùng khi hỏi xu hướng nhóm công nghệ hoặc công ty dịch vụ công nghệ."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, financial_ratios, analyst_consensus, peer_compare, news_symbol, company_events, news_market, symbol_lookup, vn_company, yf_commodities]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành công nghệ, công nghệ thông tin, dịch vụ công nghệ, chuyển đổi số, thuê ngoài công nghệ, đội ngũ kỹ sư công nghệ, phần mềm]
version: 1.0.0
---

# Công nghệ Việt Nam — framework phân tích

Ngành công nghệ VN là ngành **thuê ngoài kỹ thuật (IT services)**, không phải ngành
sản phẩm tiêu dùng. Vì vậy driver của nó là đơn hàng ký được, chất lượng hợp đồng
(thời hạn dài, đơn lớn), phân hoá giữa thị trường nước ngoài và trong nước, và tỷ
lệ sử dụng nhân công. Skill này đọc ngành bằng bốn thứ đó, **không đọc bằng giá
chứng khoán hay chỉ số ngành công nghệ quốc tế**.

Điểm dễ đọc sai nhất: **doanh thu ký (signed revenue) đi trước doanh thu nhận**.
Hợp đồng kỳ hạn 2–3 năm được ký trong kỳ này chưa vào doanh thu ngay — nó chỉ vào
theo từng quý. Đọc doanh thu nhận mà không đọc đơn ký sẽ thấy ngành "chững" trong
đúng kỳ nó đang mạnh.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm công nghệ, đơn hàng ký có ý nghĩa gì, công ty
  công nghệ có còn tăng trưởng không, tỷ lệ sử dụng nhân công nói lên điều gì.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Chỉ đọc kỹ thuật biểu đồ → `ky-thuat-chuyen-sau`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Doanh thu ký | Ký được hợp đồng dài hạn là điều kiện của doanh thu tương lai. Kỳ ký mạnh là tín hiệu dẫn cho 1–3 kỳ sau, kể cả khi doanh thu nhận của kỳ hiện tại chững | Công bố của **riêng công ty**: `news_symbol(symbol=…)` (tin gắn mã) + `company_events`; `news_market` chỉ cho bối cảnh thị trường/chính sách vì nó không tra được theo mã |
| Phân hoá nước ngoài – nội địa | Nước ngoài phụ thuộc chu kỳ khách hàng quốc tế (Nhật/EU/Mỹ); nội địa phụ thuộc chính phủ điện tử và doanh nghiệp. Hai chu kỳ khác nhau | Mảng nội địa/nước ngoài trong `financial_detail` hoặc công bố công ty |
| Chất lượng hợp đồng | Đơn lớn (trên ngưỡng) và kỳ hạn 2–3 năm cho doanh thu bền vững hơn đơn nhỏ lẻ | Tỷ trọng đơn lớn + kỳ hạn: công bố của riêng công ty qua `news_symbol`/`company_events` |
| Nhân công và năng suất | Tỷ lệ sử dụng = giờ tính phí / giờ khả dụng theo định nghĩa công ty; tỷ lệ thấp có thể do tuyển trước hợp đồng, đào tạo hoặc thiếu việc, không tự chứng minh cơ cấu lỗi thời | Tỷ lệ sử dụng từ công bố công ty; doanh thu/nhân viên bình quân từ `financial_detail` và công bố nhân sự chỉ là chỉ báo năng suất, không thay tỷ lệ sử dụng |
| Chi phí đầu vào AI | Máy tính và cơ sở hạ tầng tăng do nhu cầu AI toàn cầu; đẩy chi phí cung cấp | `yf_commodities` (chu kỳ kim loại nếu cần bối cảnh) + `news_market` |

## Các bước

**Bước 1: Nhận diện mảng (song song).**

`symbol_lookup` · `vn_company` (mảng: dịch vụ nước ngoài / trong nước / sản phẩm
riêng / viễn thông) · `financial_detail` (doanh thu theo mảng).

**Bước 2: Đơn hàng và tín hiệu dẫn (song song).**

`news_symbol(symbol=…)` + `company_events` cho công bố đơn hàng ký của riêng công ty
(giá trị hợp đồng, kỳ hạn, thị trường khách hàng) — `news_market` **không** nhận
tham số theo mã, chỉ dùng cho bối cảnh thị trường · `financial_detail` (backlog và
doanh thu chưa nhận nếu có).

**Bước 3: Chất lượng hoạt động (song song).**

`financial_detail`: doanh thu, lợi nhuận, chi phí, số nhân viên. Tự tính doanh thu
trên nhân viên bình quân cùng kỳ (ghi rõ phương pháp); tỷ lệ sử dụng cần giờ tính phí/giờ khả dụng từ công bố công ty. Thiếu số thì không suy tỷ lệ này từ doanh thu/nhân viên.

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` (kế hoạch doanh thu/lãi) · `peer_compare` (chỉ tiêu tổng quan trong nhóm) · `analyst_consensus`.

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định công ty công nghệ đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Đơn ký và backlog đang thế nào?
├─ Đơn ký tăng, kỳ hạn dài → ghi thuận lợi, tiếp Q2
├─ Đơn ký giảm, backlog giảm được xác minh → ghi áp lực nguồn doanh thu, tiếp Q2
└─ Chưa công bố → ghi thiếu dữ liệu, tiếp Q2

Q2. Mảng nào đang kéo doanh thu/lợi nhuận?
├─ Nước ngoài → Q3 (quốc tế)
├─ Nội địa → Q4 (nội địa)
├─ Hỗn hợp → xét riêng Q3 và Q4 theo tỷ trọng công bố
└─ Chưa rõ cơ cấu → ghi thiếu, tiếp Q5

Q3 (quốc tế). Chất lượng và độ tập trung hợp đồng ra sao?
├─ Dài hạn, khách hàng đa dạng → ghi thuận lợi, tiếp Q5
├─ Ngắn hạn hoặc tập trung một khách hàng/thị trường → ghi rủi ro tập trung, tiếp Q5
└─ Chưa có kỳ hạn/cơ cấu → ghi thiếu, tiếp Q5

Q4 (nội địa). Nguồn khách hàng và ngân sách ra sao?
├─ Ngân sách/hợp đồng công đã xác minh tiến độ → ghi điều kiện nghiệm thu, tiếp Q5
├─ Khách hàng tư nhân → đánh giá backlog, nhu cầu và thu tiền của khách tư, tiếp Q5
├─ Ngân sách công chậm đã xác minh → ghi áp lực, tiếp Q5
└─ Chưa rõ → ghi thiếu, tiếp Q5

Q5 (chung). Năng suất, nhân công và biên có xác nhận không?
├─ Doanh thu trên nhân viên và biên giữ/cải thiện nhiều kỳ, đơn ký thuận lợi → ★ "Được tiếp sức bởi đơn hàng và vận hành đã xác minh"
├─ Năng suất/biên giảm kéo dài hoặc đơn ký yếu → ★ "Có áp lực cần kiểm tra thời gian thuê trước doanh thu; không mặc định mở nhân sự là lỗ"
└─ Thiếu số nhân viên bình quân, biên hoặc đơn ký, hay dữ liệu trái chiều → ★ "Chưa đủ dữ liệu kết luận tổng thể; doanh thu/nhân viên không thay tỷ lệ sử dụng nhân công"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành công nghệ + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Công nghệ định giá bằng **P/E** (ngành có lãi ổn định hơn chu kỳ hàng hoá) và **P/E
trên lãi thuần từ đơn ký dài hạn** khi biên đang cải thiện. Neo kỳ vọng bằng
`planned_targets` (kế hoạch doanh thu/lãi năm) và `analyst_consensus`. Không dùng
P/E tại đỉnh khi lãi phụ thuộc một đơn lớn nhất thời — ghi rõ chất lượng lãi.

## Rủi ro đặc thù

- **Rủi ro cạn backlog**: doanh thu đang tiêu backlog mà ký yếu → tăng trưởng chững
  sau 2–3 kỳ.
- **Rủi ro tự động hoá**: tác vụ thuê ngoài truyền thống bị thay thế → thu nhập trên
  người giảm và biên co lại.
- **Rủi ro tập trung thị trường**: một thị trường khách hàng (Nhật/EU/Mỹ) đảo
  chiều kéo cả mảng nước ngoài.
- **Rủi ro nội địa theo chính sách**: mảng trong nước dựa chính phủ điện tử, nhạy
  ngân sách.
- **Rủi ro chi phí đầu vào AI**: giá máy tính và cơ sở hạ tầng làm chi phí đội lên
  khi công ty mở rộng cơ sở hạ tầng riêng.

## Ranh giới

- Không xác định pha thị trường, không suy "công nghệ sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không nội suy doanh thu từ một đơn ký lớn: đơn kỳ hạn dài vào doanh thu theo từng
  quý, ghi rõ tiến độ nhận.
- Không dùng chỉ số công nghệ quốc tế thay driver trong nước.

## Giới hạn

- Đơn hàng ký là công bố không định kỳ: khi thiếu, hạ độ tin cậy nhánh Q1.
- Thu nhập trên nhân viên là tự tính, chưa trừ người bán thời vụ và hợp đồng phụ —
  ghi rõ.
- Mảng nước ngoài chịu tỷ giá: biên lãi gộp quý có thể nhảy do tỷ giá, không phải do
  vận hành.

## Ví dụ

**Ví dụ 1:**
Hỏi: Công ty công nghệ này còn tăng trưởng được nữa không?
Đạt khi: có doanh thu ký + backlog, mảng nước ngoài/nội địa, thu nhập trên nhân
viên 2 quý, và verdict theo cây Q1→Q5.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
waterfall từ đơn ký → backlog → doanh thu nhận, multiline doanh thu theo mảng,
bar thu nhập trên nhân viên theo kỳ. Vẽ bằng `chart_render` với `from_call` (mã
`[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc đơn ký/backlog, tính thu nhập trên người và chỉ báo biên theo mảng |
