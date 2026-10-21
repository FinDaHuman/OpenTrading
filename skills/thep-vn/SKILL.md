---
name: thep-vn
description: "Đọc ngành thép VN: spread giá thép − quặng/than cốc, độ trễ tồn kho, công suất, phòng vệ thương mại, cơ cấu sản phẩm. Dùng khi hỏi nhóm thép hay lãi nhà máy thép."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành thép, nhóm thép, cổ phiếu thép, nhà máy thép, thép xây dựng, thép cuộn nóng, tôn mạ, sản lượng thép, lãi gộp thép, chi phí đầu vào thép, thép nhập khẩu]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Thép Việt Nam — framework phân tích

Lãi của nhà máy thép là **spread**: giá bán thành phẩm trừ chi phí nguyên liệu (quặng
sắt, than cốc với lò cao; thép phế với lò điện; thép cuộn nóng với nhà máy tôn mạ,
ống thép). Chi phí nguyên liệu vào giá vốn **chậm** qua tồn kho, nên biên báo cáo đi
sau giá thị trường vài tháng. Hai biến còn lại: khối lượng bán so với công suất
(phân bổ chi phí cố định) và **phòng vệ thương mại** — trong nước chặn thép nhập giá
rẻ, ở nước ngoài thì chặn thép xuất của Việt Nam.

## Khi nào dùng

- Dùng khi: hỏi nhóm thép đang được tiếp sức hay bị siết, vì sao bán nhiều hơn mà
  lãi không tăng, thép chịu gì từ giá quặng/than hay thuế chống bán phá giá.
- Khi KHÔNG dùng:
  - Pha thị trường, thép có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Chỉ hỏi giá thép/quặng hôm nay → tra giá, không cần skill.
  - Xi măng, vật liệu xây dựng khác: driver khác, skill này không áp dụng.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Spread nguyên liệu – thành phẩm | Giá bán trừ chi phí nguyên liệu trên mỗi tấn. Giá bán giảm cùng lúc nguyên liệu tăng là trạng thái xấu nhất | Giá quặng sắt, than cốc, thép phế, thép cuộn nóng khu vực và giá thép xây dựng trong nước: `web_search` (ghi nguồn, ngày, loại giá); biên lãi gộp: `financial_detail(statement=KQKD)` |
| Độ trễ tồn kho | Nguyên liệu mua lúc giá cao còn nằm trong kho thì biên còn nén thêm vài tháng sau khi giá thị trường đã đảo chiều, và ngược lại | Hàng tồn kho (CDKT) so với giá vốn quý (KQKD) → số ngày tồn kho |
| Khối lượng và công suất | Bán được bao nhiêu so với công suất quyết định chi phí cố định trên mỗi tấn; nhà máy mới chạy chưa đủ tải thì biên thấp dù doanh thu tăng | Sản lượng bán, công suất: công bố công ty (`news_symbol`) hoặc hiệp hội thép (`web_search`) |
| Phòng vệ thương mại | Thuế chống bán phá giá/tự vệ trong nước giữ giá bán nội địa; điều tra ở thị trường nhập khẩu thép Việt Nam thu hẹp đầu ra xuất khẩu | Văn bản, phạm vi, thời hạn: `web_search`, ghi số hiệu + ngày |
| Cơ cấu sản phẩm | Thép xây dựng bám xây dựng trong nước và đầu tư công; thép cuộn nóng bám giá khu vực; tôn mạ, ống thép xuất khẩu nhiều nên bám đơn hàng và phòng vệ ở nước ngoài | Doanh thu theo mảng/thị trường: `financial_detail(statement=TM)`; công bố công ty |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo sản phẩm/thị trường). Xác định nhóm sản phẩm lớn nhất.

**Bước 2 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
chi phí lãi vay) · `financial_detail(symbol, statement=CDKT)` (hàng tồn kho, vay) · 
`web_search` cho hai đầu spread: giá nguyên liệu và giá thép cùng kỳ (ghi nguồn + ngày).

**Bước 3 (song song):** `news_symbol(symbol)` (sản lượng bán theo tháng, nhà máy mới) ·
`web_search` (văn bản phòng vệ thương mại đang áp dụng, điều tra ở thị trường xuất
khẩu, sản lượng toàn ngành).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với nhà máy cùng nhóm sản phẩm:
biên, tồn kho của peer đọc bằng `financial_detail` từng mã (tối đa 3); `peer_compare`
chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định nhà máy thép đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Spread giá thép − nguyên liệu đang nở hay hẹp?
├─ Nở → tiếp Q2
├─ Hẹp → tiếp Q3
└─ Chưa dựng được hai đầu giá → tiếp Q2, ghi "thiếu spread"

Q2. Khối lượng có đủ để gánh chi phí cố định không?
├─ Nhà máy mới hoặc dây chuyền chính chạy thấp tải → ★ "Biên đang bị công suất kìm:
│  theo dõi tiến độ nâng tải trước khi nhìn biên"
└─ Sản lượng ổn hoặc tăng, hoặc không có số công suất → tiếp Q4

Q3. Spread hẹp vì đâu?
├─ Nguyên liệu tăng → tiếp Q5
├─ Giá bán giảm khi thép nhập khẩu giá rẻ tăng và rào phòng vệ yếu hoặc hết hạn →
│  ★ "Bị siết bởi hàng nhập khẩu: giá bán trong nước khó giữ"
├─ Giá bán giảm vì cầu xây dựng trong nước yếu → ★ "Bị siết bởi cầu nội địa: sản
│  lượng và giá cùng xuống"
└─ Chưa tách được nguyên nhân → ★ "Spread đang hẹp, chưa rõ nguyên nhân: biên kỳ tới
   khó cải thiện, độ tin cậy thấp"

Q4. Nhóm sản phẩm chính bán ở đâu?
├─ Chủ yếu xuất khẩu (tôn mạ, ống thép, thép cuộn) → tiếp Q6
└─ Chủ yếu trong nước (thép xây dựng) → ★ "Được tiếp sức: spread nở, sản lượng ổn;
   biến cần theo dõi là cầu xây dựng và đầu tư công"

Q5. Nguyên liệu giá cao đã đi hết qua tồn kho chưa?
├─ Chưa (số ngày tồn kho cao, mua lúc giá đỉnh) → ★ "Biên còn bị nén thêm: đợi tồn
│  kho giá cao tiêu hết trước khi kỳ vọng hồi phục"
├─ Rồi → ★ "Biên đã phản ánh giá nguyên liệu mới: hướng spread trên thị trường là
│  chỉ báo trước cho biên các quý tới"
└─ Không đọc được tồn kho → ★ "Biên bị nén bởi nguyên liệu, độ trễ chưa xác định:
   độ tin cậy thấp"

Q6 (xuất khẩu). Thị trường nhập khẩu chính có đang điều tra/áp thuế thép Việt Nam không?
├─ Có → ★ "Bị siết ở đầu ra xuất khẩu: đọc tỷ trọng thị trường bị áp thuế trong
│  doanh thu"
└─ Không → ★ "Được tiếp sức: spread nở, đầu ra xuất khẩu chưa bị chặn; giá khu vực
   là biến cần theo dõi"

## Chỉ báo đặc thù ngành

Cách đọc từng dòng và công thức tự tính ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Thép là ngành chu kỳ: dùng **EV/EBITDA** và **P/B** so với vùng của chính doanh nghiệp
qua nhiều năm; P/E thấp nhất thường rơi đúng lúc lãi đỉnh. EV/EBITDA tự tính từ
`financial_detail` (ghi công thức). Nhà máy đang nâng tải: ghi rõ công suất đã chạy so
với thiết kế trước khi so biên.

## Rủi ro đặc thù

- Giá bán giảm cùng lúc nguyên liệu tăng.
- Tồn kho nguyên liệu giá cao làm biên xấu thêm sau khi thị trường đã đảo chiều.
- Hết hạn hoặc thu hẹp phạm vi phòng vệ thương mại trong nước.
- Thị trường xuất khẩu điều tra chống bán phá giá, cơ chế điều chỉnh carbon biên giới.
- Nhà máy mới vay nhiều: chi phí lãi vay và khấu hao chạy trước sản lượng.

## Ranh giới

- Không xác định pha thị trường, không nói "thép sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu mức thuế phòng vệ, phạm vi điều tra từ trí nhớ: tra văn bản, ghi số
  hiệu + ngày (luật này chỉ nằm ở đây).
- Giá thép quốc tế không thay giá bán của công ty; giá bán thực lấy từ doanh thu /
  sản lượng hoặc công bố công ty.

## Giới hạn

- Giá nguyên liệu tra được là giá tham chiếu thị trường, không phải giá hợp đồng của
  nhà máy.
- Sản lượng, công suất là công bố không định kỳ; thiếu thì ghi rõ nhánh nào độ tin
  cậy thấp.

## Ví dụ

Hỏi: Bán nhiều thép hơn mà lãi không tăng, tại sao?
Đạt khi: có hai đầu spread kèm nguồn và ngày, sản lượng so công suất, biên lãi gộp
4 quý, số ngày tồn kho, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường biên lãi gộp theo quý,
cột giá vốn và doanh thu, cột số ngày tồn kho của nhóm. Vẽ bằng `chart_render` với
`from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có; cần chọn loại hình thì
nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần tên dòng theo statement, công thức số ngày tồn kho, giá bán bình quân và EV/EBITDA |
