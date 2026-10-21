---
name: dien-luc-vn
description: "Đọc ngành điện VN: giá bán lẻ và công nợ EVN, thuỷ văn, mức huy động theo loại nguồn, nhiên liệu, quy hoạch điện. Dùng khi hỏi nhóm điện hay một nhà máy điện."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, yf_commodities, vn_forex_ohlcv, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành điện, nhóm điện, cổ phiếu điện, nhà máy điện, thủy điện, nhiệt điện, điện khí, năng lượng tái tạo, điều chỉnh giá điện, giá bán lẻ điện, quy hoạch điện, sản lượng điện]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Điện lực Việt Nam — framework phân tích

Phần lớn sản lượng của nhà máy điện bán cho **một người mua chính** (EVN, qua công ty
mua bán điện), theo hợp đồng mua bán điện và thị trường phát điện cạnh tranh. Vì vậy
biến quyết định không chỉ là nhu cầu điện tăng mà là **giá bán lẻ có theo kịp chi
phí không**: giá bán lẻ thấp hơn chi phí thì EVN lỗ và chậm trả tiền cho nhà máy; giá
được điều chỉnh đủ thì cả chuỗi được trả đúng hạn. Biến thứ hai là **loại nguồn**:
thuỷ điện, nhiệt điện than, điện khí, tái tạo và xây lắp – thiết bị điện là năm chu
kỳ khác nhau, và thuỷ văn quyết định nguồn nào được huy động nhiều.

## Khi nào dùng

- Dùng khi: hỏi nhóm điện đang được tiếp sức hay bị siết, một nhà máy điện chịu gì,
  giá điện điều chỉnh tác động ra sao, thuỷ văn ảnh hưởng nhóm nào.
- Khi KHÔNG dùng:
  - Pha thị trường, điện có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Hỏi tiền điện sinh hoạt, biểu giá bậc thang → tra trực tiếp, không cần skill.
  - Khu công nghiệp → `bat-dong-san-vn`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Giá bán lẻ và công nợ | Giá bán lẻ bình quân được điều chỉnh theo cơ chế định kỳ; điều chỉnh chậm hơn chi phí thì EVN lỗ và nợ nhà máy kéo dài | Cơ chế + lần điều chỉnh gần nhất: `web_search` (văn bản, ngày); phải thu khách hàng (CDKT) so với doanh thu (KQKD) |
| Thuỷ văn | Lượng nước về hồ quyết định sản lượng thuỷ điện; năm khô hạn thì nhiệt điện, điện khí được huy động bù | `web_search` (lưu lượng nước về hồ, dự báo thời tiết theo mùa, ghi vùng + kỳ); sản lượng: `news_symbol` |
| Mức huy động | Thị trường điện ưu tiên nguồn giá thấp; nguồn đắt chỉ được huy động khi thiếu điện, phần còn lại theo sản lượng hợp đồng | Sản lượng phát và cơ cấu nguồn toàn hệ thống: `web_search`; của mã: `news_symbol` |
| Nhiên liệu và tỷ giá | Than, LNG nhập khẩu và tỷ giá quyết định chi phí nhiệt điện, điện khí; chi phí này chuyển được vào giá bán đến đâu tuỳ hợp đồng | LNG/dầu tham chiếu: `yf_commodities` (BZ=F, NG=F); than: `web_search`; tỷ giá: `vn_forex_ohlcv` |
| Quy hoạch điện | Quy hoạch điện VIII và các bản điều chỉnh quyết định nguồn nào được xây thêm, lưới truyền tải nào được đầu tư — đơn hàng của xây lắp, thiết bị điện | `web_search` (văn bản, ngày) |
| Giá tái tạo | Giá mua điện gió, mặt trời (giá ưu đãi cũ, khung giá mới, mua bán điện trực tiếp) và việc cắt giảm công suất quyết định doanh thu tái tạo | `web_search`, `news_symbol` |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo nhà máy/mảng). Xác định **loại nguồn đóng góp lợi
nhuận lớn nhất**; cây đi theo loại đó.

**Bước 2 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
chi phí lãi vay) · `financial_detail(symbol, statement=CDKT)` (phải thu khách hàng,
vay), 4–8 quý.

**Bước 3 (song song):** `web_search` (cơ chế và lần điều chỉnh giá bán lẻ, thuỷ văn,
huy động theo nguồn — tuỳ loại nguồn) · `news_symbol(symbol)` + `company_events(symbol)`
(sản lượng tháng, hợp đồng, dự án) · `yf_commodities` khi là điện khí.

**Bước 4:** `planned_targets` (kế hoạch sản lượng, lợi nhuận) · `analyst_consensus`. So
với nhà máy **cùng loại nguồn**; chỉ báo vận hành của peer đọc bằng `financial_detail`
từng mã, `peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định nhà máy điện đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Loại nguồn đóng góp lợi nhuận lớn nhất?
├─ Thuỷ điện → tiếp Q2
├─ Nhiệt điện than, điện khí → tiếp Q3
├─ Gió, mặt trời → tiếp Q4
└─ Xây lắp, thiết bị, truyền tải → ★ "Bám tiến độ đầu tư lưới và nguồn theo quy
   hoạch điện: đọc giá trị hợp đồng mới thay vì giá điện"

Q2 (thuỷ). Thuỷ văn đang thuận hay nghịch?
├─ Nghịch (nước về hồ thấp, mùa khô kéo dài) → ★ "Bị siết bởi thuỷ văn: sản lượng
│  thấp, theo dõi dự báo mùa mưa trước khi kỳ vọng hồi phục"
├─ Thuận → tiếp Q4
└─ Không có số thuỷ văn → tiếp Q4

Q3 (nhiệt, khí). Chi phí nhiên liệu có chuyển được vào giá bán không?
├─ Chi phí tăng mà giá bán không theo (hợp đồng chặn, giá bán lẻ chưa điều chỉnh)
│  → ★ "Bị siết bởi chi phí nhiên liệu: biên nén cho đến khi giá được điều chỉnh"
├─ Chuyển được hoặc nhiên liệu ổn → tiếp Q4
└─ Không xác định → tiếp Q4

Q4 (chung). Tiền bán điện có về đúng hạn không?
├─ Phải thu khách hàng tăng nhanh hơn doanh thu → ★ "Bị siết bởi công nợ: doanh
│  thu ghi nhận nhưng tiền chưa về, chi phí lãi vay tăng"
└─ Ổn, hoặc không đọc được → tiếp Q5

Q5 (chung). Nhà máy có được huy động cao không?
├─ Huy động cao hoặc tăng → ★ "Được tiếp sức: sản lượng tốt và tiền về đúng hạn"
├─ Huy động thấp vì nguồn rẻ hơn được ưu tiên hoặc bị cắt giảm công suất → ★ "Bị
│  siết bởi huy động: chi phí cố định vẫn chạy khi sản lượng thấp"
└─ Không có số huy động → ★ "Tạm ổn ở các bước trên, chưa đọc được huy động: độ tin
   cậy trung bình"

## Chỉ báo đặc thù ngành

Cách đọc theo loại nguồn ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Điện định giá **theo loại nguồn**: thuỷ điện và nhà máy hết khấu hao dùng **P/E và
cổ tức** (dòng tiền đều); nhà máy mới vay nhiều dùng **EV/EBITDA** và dòng tiền chiết
khấu theo vòng đời hợp đồng. Năm thuỷ văn tốt làm P/E thuỷ điện thấp bất thường — so
nhiều năm. Chỉ so trong cùng loại nguồn.

## Rủi ro đặc thù

- Giá bán lẻ điều chỉnh chậm hơn chi phí → công nợ với nhà máy kéo dài.
- Năm khô hạn kéo dài: thuỷ điện giảm sản lượng nhiều quý liền.
- Nhiên liệu nhập khẩu và tỷ giá: chi phí điện khí, nhiệt điện than nhập.
- Tái tạo: rủi ro giá mua điện được xem lại và cắt giảm công suất.
- Dự án mới chưa ký hợp đồng mua bán điện: dòng thu chưa chắc chắn.

## Ranh giới

- Không xác định pha thị trường, không nói "điện sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu giá điện, khung giá, cơ chế điều chỉnh hay nội dung quy hoạch từ trí
  nhớ: tra văn bản, ghi số hiệu + ngày (luật này chỉ nằm ở đây).
- Chỉ so trong cùng loại nguồn; thuỷ điện và nhiệt điện là hai chu kỳ ngược nhau.

## Giới hạn

- Thuỷ văn và cơ cấu huy động toàn hệ thống công bố theo kỳ, có độ trễ — ghi kỳ.
- Phải thu khách hàng không tách riêng phần của EVN ở mọi kỳ — nói rõ khi đọc tổng.

## Ví dụ

Hỏi: Nhóm thuỷ điện bị ảnh hưởng gì bởi thuỷ văn?
Đạt khi: có tình trạng thuỷ văn kèm vùng và kỳ, sản lượng của mã, phải thu so với
doanh thu, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột sản lượng/doanh thu theo
quý, đường phải thu so với doanh thu, cột biên lãi gộp các nhà máy cùng loại. Vẽ
bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có;
cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần nhận diện loại nguồn, dòng BCTC theo statement và cách đọc phải thu, sản lượng, biên |
