---
name: cong-nghe-vn
description: "Phân tích ngành công nghệ Việt Nam theo giá trị hợp đồng ký, phân hoá nội địa và nước ngoài, đơn hàng dài hạn và tỷ lệ sử dụng nhân công. Dùng khi hỏi xu hướng nhóm công nghệ hoặc công ty dịch vụ công nghệ."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, financial_ratios, analyst_consensus, peer_compare, news_symbol, company_events, news_market, symbol_lookup, vn_company, yf_commodities]
triggers:
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
| Tỷ lệ sử dụng nhân công | Ngành vốn người: nhân công sử dụng thấp đồng nghĩa biên giảm và cơ cấu lỗ thời, đặc biệt khi tác vụ truyền thống bị tự động hoá | Số nhân viên + thu nhập/người: `financial_detail` (tự tính, ghi rõ). So quý trước |
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

`financial_detail`: doanh thu, lợi nhuận, chi phí, số nhân viên. Tự tính thu nhập
trên mỗi nhân viên (ghi rõ tự tính) và so quý trước.

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` (kế hoạch doanh thu/lãi) · `peer_compare` (so tăng trưởng, biên,
thu nhập/người trong nhóm) · `analyst_consensus`.

## Cây quyết định công ty công nghệ đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Đơn hàng ký của kỳ đang dẫn doanh thu tương lai không?
├─ Có, ký mạnh và/hoặc đơn lớn kỳ hạn dài → tiếp Q2
├─ Không công bố được → ghi thiếu dữ liệu, tiếp Q2 với độ tin cậy thấp
└─ Ký yếu trong khi doanh thu nhận vẫn đẹp → ★ "Doanh thu đang tiêu backlog: đọc
   backlog trước, nguồn tăng trưởng có thể đang cạn"

Q2. Mảng nào đang kéo?
├─ Nước ngoài → tiếp Q3 (nhánh quốc tế)
├─ Trong nước → tiếp Q4 (nhánh nội địa)
└─ Không mảng nào > nửa doanh thu → đọc cả hai nhánh

Q3 (quốc tế). Đơn hàng có đang dài hạn và tập trung thị trường không?
├─ Đơn kỳ hạn 2–3 năm, quy mô lớn, thị trường đa dạng → Q5
└─ Đơn ngắn hạn, nhỏ lẻ, tập trung một thị trường → ★ "Rủi ro tập trung: một thị
   trường khách hàng đảo chiều là cả mảng đảo chiều"

Q4 (nội địa). Doanh thu nội địa có bám chính phủ điện tử không?
├─ Có và chính sách đang tiếp tục → Q5
└─ Có nhưng chính sách chững hoặc quay ra doanh nghiệp tư nhân → ★ "Nội địa dựa
   chính sách: đọc kỳ vọng ngân sách chính phủ trước khi nội suy"

Q5 (chung). Thu nhập trên mỗi nhân viên đang đi đâu?
├─ Tăng hoặc giữ trong khi doanh thu tăng → ★ "Được tiếp sức: tăng trưởng không
   phải bằng thuê thêm người — đọc 2 quý liền mới xác nhận"
└─ Giảm (thuê nhanh hơn doanh thu) → ★ "Bị siết bởi nhân công: mở rộng bằng đầu
   người làm biên giảm — hạ độ tin cậy kỳ vọng lãi"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành công nghệ + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Công nghệ định giá bằng **P/E** (ngành có lãi ổn định hơn chu kỳ hàng hoá) và **P/E
trên lãi thuần từ đơn ký dài hạn** khi biên đang cải thiện. Anchor kỳ vọng bằng
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
