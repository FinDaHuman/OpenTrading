---
name: hoa-chat-vn
description: "Đọc ngành phân bón – hoá chất VN: giá ure, phốt pho, chính sách xuất khẩu Trung Quốc, giá khí đầu vào, tồn kho, thuế GTGT. Dùng khi hỏi nhóm phân bón hay hoá chất."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành hoá chất, nhóm hoá chất, ngành phân bón, nhóm phân bón, cổ phiếu phân bón, công ty phân bón, doanh nghiệp phân bón, giá ure, phân đạm, phốt pho vàng, nhà máy đạm]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Phân bón & hoá chất Việt Nam — framework phân tích

Ngành này lãi theo **cửa sổ giá**: lợi nhuận đến từ giai đoạn giá bán vượt xa chi phí
đầu vào, và cửa sổ đó có thể mở rồi đóng trong vài quý. Các nhóm chính: **phân đạm
(ure)** từ khí hoặc than — giá bám thị trường ure thế giới, chi phí bám giá khí đầu
vào; **phân lân, NPK** — bán chủ yếu trong nước, bám mùa vụ và giá nông sản; **hoá chất
phốt pho** (phốt pho vàng, axit phosphoric) — giá bám thị trường Trung Quốc và xuất
khẩu. Trung Quốc là biến cung lớn: hạn chế xuất khẩu phân bón, hoá chất của Trung Quốc
làm giá thế giới tăng, nới ra thì giá giảm.

## Khi nào dùng

- Dùng khi: hỏi nhóm phân bón/hoá chất đang được tiếp sức hay bị siết, vì sao lãi
  nhảy rồi sụt, công ty phân bón chịu gì từ giá ure thế giới hay chính sách Trung Quốc.
- Khi KHÔNG dùng:
  - Pha thị trường, phân bón có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Xuất khẩu nông sản → `xuat-nhap-khau-vn`.
  - Nhựa, cao su, săm lốp: driver khác, skill này không áp dụng.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Giá bán | Giá ure, DAP, phốt pho vàng thế giới nhảy theo cú sốc cung (địa chính trị, chính sách Trung Quốc, giá khí châu Âu) rồi về lại; giá trong nước theo cạnh tranh và mùa vụ | Giá tham chiếu và giá trong nước: `web_search` (ghi loại giá, khu vực, ngày) |
| Chính sách xuất khẩu Trung Quốc | Hạn ngạch, kiểm tra xuất khẩu làm giảm cung ra thế giới → giá tăng; nới ra thì ngược lại | `web_search`, ghi thông báo + ngày |
| Giá khí đầu vào | Nhà máy đạm dùng khí mua theo hợp đồng, giá thường gắn với giá dầu/nhiên liệu tham chiếu; nhà máy dùng than chịu giá than | Điều khoản hợp đồng: công bố công ty, `web_search`; hướng giá dầu: `yf_commodities(tickers=["BZ=F"])` |
| Mùa vụ và cầu trong nước | Cầu phân bón trong nước theo mùa vụ lúa và giá nông sản; giá nông sản thấp thì nông dân giảm bón | `web_search` (mùa vụ, giá lúa), sản lượng bán của công ty: `news_symbol` |
| Thuế GTGT với phân bón | Chính sách thuế GTGT quyết định doanh nghiệp có được khấu trừ thuế đầu vào hay phải tính vào giá vốn | Văn bản hiện hành: `web_search`, ghi số hiệu + ngày hiệu lực |
| Tồn kho | Nguyên liệu mua trước khi giá tăng đỡ biên vài tháng; thành phẩm làm lúc chi phí cao bán khi giá giảm thì biên nén | Hàng tồn kho (CDKT) so với giá vốn (KQKD) |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo sản phẩm, xuất khẩu). Xác định sản phẩm chính và tỷ lệ
xuất khẩu.

**Bước 2 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
biên) · `financial_detail(symbol, statement=CDKT)` (hàng tồn kho), 4–8 quý.

**Bước 3 (song song):** `web_search` (giá sản phẩm chính trong nước và thế giới, chính
sách xuất khẩu Trung Quốc, văn bản thuế GTGT — ghi nguồn + ngày) · `news_symbol(symbol)`
(sản lượng, giá khí, bảo dưỡng nhà máy) · `yf_commodities` (hướng giá dầu nếu là đạm
từ khí).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với doanh nghiệp **cùng sản
phẩm** (ure với ure, NPK với NPK); chỉ báo vận hành đọc bằng `financial_detail` từng mã,
`peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định công ty phân bón/hoá chất đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Giá bán theo thị trường nào?
├─ Giá thế giới (xuất khẩu lớn, hoặc ure/phốt pho bám giá thế giới) → tiếp Q2
├─ Chủ yếu bán trong nước theo mùa vụ (lân, NPK) → tiếp Q4
└─ Không rõ tỷ lệ xuất khẩu → tiếp Q2, ghi rõ

Q2 (giá thế giới). Cửa sổ giá đang mở hay đóng?
├─ Giá đang giảm về sau cú sốc → ★ "Cửa sổ giá đang đóng: doanh thu theo giá thị
│  trường, biên co về; tồn kho làm lúc chi phí cao sẽ nén thêm"
├─ Giá đang cao hoặc tăng → tiếp Q3
└─ Không dựng được giá → tiếp Q5

Q3 (giá thế giới). Trung Quốc đang hạn chế hay nới xuất khẩu sản phẩm này?
├─ Hạn chế → ★ "Cung thế giới đang bị thắt: cửa sổ giá còn mở, nhưng phụ thuộc chính
│  sách — ghi rõ là cơ hội theo chính sách"
├─ Nới → ★ "Cung Trung Quốc quay lại: cửa sổ giá sắp đóng, đọc giá chào bán gần nhất"
└─ Không đổi hoặc chưa tra được → tiếp Q5

Q4 (trong nước). Cầu mùa vụ và giá bán trong nước có cùng chiều không?
├─ Giá nông sản thấp, nông dân giảm bón, giá bán khó tăng → ★ "Bị siết bởi cầu
│  trong nước: giá thế giới tăng cũng khó chuyển vào giá bán"
└─ Cầu ổn hoặc tăng, hoặc không có số → tiếp Q5

Q5 (chung). Biên lãi gộp và chi phí đầu vào?
├─ Giá bán tăng nhanh hơn chi phí, biên mở 2 quý liền → ★ "Được tiếp sức: cửa sổ giá
│  đang vào lợi nhuận"
├─ Chi phí khí/nguyên liệu đuổi kịp giá bán → ★ "Bị siết bởi chi phí: cửa sổ giá
│  không còn đủ rộng"
└─ Một quý biên tốt chưa đủ xác nhận → ★ "Biên cải thiện mới một quý, có thể nhờ tồn
   kho giá rẻ: độ tin cậy thấp"

## Chỉ báo đặc thù ngành

Cách đọc theo sản phẩm ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Ngành chu kỳ giá: **EV/EBITDA** và **P/B** so vùng của chính doanh nghiệp qua nhiều
năm; P/E thấp nhất thường rơi đúng đỉnh cửa sổ giá. Đánh dấu kỳ lãi bất thường là cửa
sổ giá, không nội suy. Doanh nghiệp trả cổ tức tiền mặt đều: đọc thêm lợi suất cổ tức.

## Rủi ro đặc thù

- Cửa sổ giá đóng nhanh khi cung Trung Quốc quay lại hoặc giá khí châu Âu giảm.
- Giá khí đầu vào tăng theo giá dầu trong khi giá ure giảm.
- Nhà máy dừng bảo dưỡng: sản lượng hụt một quý.
- Cầu trong nước yếu khi giá nông sản thấp.
- Thay đổi chính sách thuế GTGT đổi giá vốn và giá bán.

## Ranh giới

- Không xác định pha thị trường, không nói "phân bón sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu chính sách Trung Quốc, thuế suất GTGT hay giá khí hợp đồng từ trí nhớ: tra,
  ghi nguồn + ngày (luật này chỉ nằm ở đây).
- Giá thế giới không thay giá bán thực của công ty; giá bán thực từ doanh thu / sản
  lượng hoặc công bố công ty.

## Giới hạn

- Giá tham chiếu tra được không phải giá hợp đồng của từng nhà máy.
- Tỷ lệ xuất khẩu và sản lượng là công bố không định kỳ — ghi rõ khi thiếu.

## Ví dụ

Hỏi: Giá ure tăng mạnh thì công ty phân bón hưởng không?
Đạt khi: có giá ure kèm loại giá và ngày, tỷ lệ xuất khẩu của mã, chính sách Trung Quốc,
biên 2 quý, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường biên lãi gộp theo quý,
cột doanh thu theo sản phẩm, cột số ngày tồn kho. Vẽ bằng `chart_render` với
`from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có; cần chọn loại hình thì
nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần nhận diện nhóm sản phẩm, dòng BCTC theo statement, công thức số ngày tồn kho |
