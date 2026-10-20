---
name: chung-khoan-vn
description: "Phân tích ngành chứng khoán VN theo đòn bẩy và cơ cấu doanh thu: dư nợ margin so vốn chủ, spread margin, sự dịch chuyển từ phí sang mảng cân đối. Dùng khi hỏi xu hướng ngành chứng khoán hay đọc kết quả công ty chứng khoán."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, stock_overview, planned_targets, analyst_consensus, peer_compare, market_overview, breadth_scan, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [chứng khoán, ngành chứng khoán, công ty chứng khoán, dư nợ margin, cho vay ký quỹ, môi giới chứng khoán, lãi margin, doanh thu môi giới, tự doanh, ctck vn]
version: 1.0.0
---

# Chứng khoán Việt Nam — framework phân tích

Ngành chứng khoán VN đã rời mô hình "sống bằng phí môi giới": doanh thu đang dịch
sang **mảng cân đối** (đầu tư tự doanh + cho vay ký quỹ). Vì vậy skill này đọc
ngành qua **đòn bẩn** (dư nợ margin so vốn chủ và so trần cho phép), **chất lượng
đòn bẩy đó** (spread margin) và **cơ cấu doanh thu** (mảng nào đang nuôi lãi),
không đọc bằng doanh thu môi giới — mảng này bị cạnh tranh phí 0 làm méo giá trị
chỉ báo.

BCTC công ty chứng khoán đọc qua chuẩn mực riêng (`vs_financial_norms(btype=2)`).

## Khi nào dùng

- Dùng khi: user hỏi xu hướng ngành chứng khoán, kết quả một công ty chứng khoán,
  dư nợ margin có rủi ro không, ngành hưởng gì từ nâng hạng thị trường.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đo/xác minh bằng |
|---|---|---|
| Dư nợ margin | Mềm dai nhất của ngành: nhà đầu tư vay mua cổ phiếu. Dư nợ tăng liên tục = nhận thức rủi ro đang mở ra; giảm đột ngột = thị trường vừa xả hoặc CTCK siết gọi ký quỹ | Tổng dư nợ margin ngành + của mã: `news_market`/`web_search` (các CTCK lớn công bố dư nợ theo quý), riêng mã đọc `financial_detail` |
| Mức đòn bẩy | Dư nợ margin so vốn chủ so với **trần quy định** (2× vốn chủ) quyết định còn bao nhiêu chỗ tăng trưởng. Gần trần → tăng trưởng phải đến từ vốn mới hoặc tự doanh | Tính từ `financial_detail` (dư nợ cho vay ký quỹ, vốn chủ) — ghi rõ công thức tự tính |
| Spread margin | Lãi margin cố định trong ngắn hạn (11–13,5%/năm) nhưng chi phí huy động của CTCK tăng theo tiền gửi và giấy tờ có giá → spread nén là rủi ro lợi nhuận trực tiếp | Lãi margin trung bình + chi phí vốn: `news_market` + `financial_detail` |
| Cơ cấu doanh thu | Ngành dịch từ phí sang cân đối. Nhóm nội địa phụ thuộc đầu tư + margin; nhóm nước ngoài cân bằng hơn. Cơ cấu quyết định nhóm nào chịu thị trường giảm | `financial_detail` (chuẩn CTCK): doanh thu môi giới · cho vay ký quỹ · đầu tư · tư vấn |
| Thanh khoản thị trường | Phí môi giới bị cạnh tranh phí 0 làm mất giá trị đo lường, nhưng thanh khoản vẫn là nền cho ký quỹ và tự doanh | `market_overview` · `breadth_scan` · `vs_market_info` |
| Cơ chế mới | Non-prefunding, hệ thống bù trừ (CCP), nâng hạng thị trường theo đợt, pipeline IPO/ECM → phí tư vấn bảo lãnh và vốn chủ mở rộng | `news_market`/`web_search`; ghi rõ nguồn và mốc thời gian |

## Các bước

Khoảng 4 lượt gọi tool. Bắt buộc có `vs_financial_norms(btype=2)` TRƯỚC khi đọc
dòng BCTC công ty chứng khoán.

**Bước 1: Chuẩn mực + nhận diện mã (song song).**

`vs_financial_norms(btype=2)` · `symbol_lookup` (nếu user đưa tên công ty) ·
`vn_company` (mô hình kinh doanh, nhóm cổ đông — công ty con ngân hàng hay độc lập).

**Bước 2: Đòn bẩy + cơ cấu doanh thu (song song).**

`financial_detail`: dư nợ cho vay ký quỹ · vốn chủ · doanh thu theo 4 mảng ·
các khoản phải thu. Tự tính mức đòn bẩn (ghi rõ công thức) và so trần quy định.

**Bước 3: Nhịp thị trường + spread (song song).**

`market_overview` (giá bluechip, movers, độ rộng) · `breadth_scan` (độ rộng có
thật không) · `news_market` (dư nợ margin ngành, lãi margin, chi phí vốn CTCK).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` (kế hoạch năm) · `peer_compare` (so mức đòn bẩn, cơ cấu doanh
thu, ROE với nhóm cùng mô hình) · `analyst_consensus` (neo kỳ vọng, không thay
thế kết luận).

## Cây quyết định ngành đang được tiếp sức hay bị siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu ở
một nhánh thì hạ độ tin cậy, không bù số.

Q1. Dư nợ margin ngành đang tăng hay giảm?
├─ Tăng liên tục nhiều quý → tiếp Q2
└─ Giảm hoặc đi ngang → ★ "Đòn bẩn đang rút: driver tăng trưởng chuyển sang tự
   doanh và phí tư vấn — đọc cơ cấu doanh thu trước khi kỳ vọng lãi từ ký quỹ"

Q2. Mức đòn bẩn của mã còn cách trần bao xa?
├─ Đã gần trần quy định → ★ "Chỗ tăng trưởng từ ký quỹ bị chặn: cần vốn mới —
   đọc kế hoạch huy động trong `planned_targets`/`news_market`"
├─ Còn cách xa trần → tiếp Q3
└─ Chưa tính được (thiếu vốn chủ hoặc dư nợ) → tiếp Q3 với độ tin cậy thấp

Q3. Spread margin đang nở hay nén?
├─ Nén (chi phí vốn CTCK tăng nhanh hơn lãi margin) → ★ "Bị siết bởi vốn: mảng
   ký quỹ tăng trưởng nhưng lãi không theo"
└─ Nở hoặc ổn định → tiếp Q4

Q4. Cơ cấu doanh thu đã dịch sang cân đối chưa?
├─ Vẫn phụ thuộc phí môi giới → ★ "Rủi ro cạnh tranh phí: doanh thu bị bòn từ
   biên, đọc cơ cấu trước khi xếp hạng nhóm"
└─ Đã dịch sang ký quỹ + đầu tư → tiếp Q5

Q5. Cơ chế mới (nâng hạng theo đợt, CCP, pipeline IPO) có mở thêm vòng tăng trưởng không?
├─ Có, còn trong lộ trình → ★ "Ngành được tiếp sức bởi thể chế: vốn chủ mở rộng,
   phí tư vấn tăng, khách hàng tổ chức hóa — ghi mốc thời gian từng đợt"
└─ Đã qua giai đoạn chính → ★ "Ngành bước vào giai đoạn tăng trưởng chọn lọc:
   lợi nhuận đến từ nhóm có vốn và cơ cấu tốt, không phải cả ngành"

## Chỉ báo đặc thù ngành

Bảng dòng BCTC công ty chứng khoán + cách đọc từng chỉ báo ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Ngành chứng khoán định giá bằng **P/B neo ROE**: cùng một P/B, CTCK ROE 13% và
ROE 25% là hai giá trị khác nhau. Nhóm theo mô hình kinh doanh (nội địa cân bằng /
nội địa theo ngân hàng / nước ngoài) rồi so P/B trong nhóm (`valuation_run` cho
vùng, `peer_compare` để xếp hạng). Kỳ vọng neo bằng `planned_targets` và
`analyst_consensus`. Lợi nhuận phụ thuộc tự doanh → một quý lãi bất thường không
kéo dài: ghi rõ chất lượng lãi trước khi dùng P/E.

## Rủi ro đặc thù

- **Rủi ro đòn bẩy hai chiều**: dư nợ margin giảm nhanh khi thị trường xả → cả
  doanh thu ký quỹ lẫn chất lượng danh mục tự doanh xấu đi cùng lúc.
- **Rủi ro gần trần**: gần trần ký quỹ thì một đợt tăng thị trường cũng không
  tạo thêm tăng trưởng cho mảng này.
- **Rủi ro cạnh tranh phí**: phí môi giới bị nén cấu trúc, không phá được bằng
  cách nào.
- **Rủi ro chất lượng danh mục**: tự doanh giữ trái phiếu doanh nghiệp → rủi ro
  tín dụng của khách hàng doanh nghiệp lọt vào bảng CTCK.
- **Rủi ro phụ thuộc nhịp phiên**: thanh khoản giảm kéo cả 3 mảng.

## Ranh giới

- Không xác định pha thị trường, không bảo "chứng khoán sắp dẫn sóng", không đọc
  chuỗi luân chuyển hay chỉ báo dẫn dắt theo tuần → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy dư nợ margin ngành từ một CTCK: đó là số riêng của mã. Số ngành lấy
  từ công bố hoặc báo chí có nguồn, ghi kỳ.
- Luật về trần ký quỹ chỉ nằm ở đây, không lặp trong `references/kpi.md`.

## Giới hạn

- Dư nợ margin ngành tổng hợp từng quý, có độ trễ: kết luận theo tháng cần ghi rõ
  đang dùng số kỳ nào.
- Cơ cấu doanh thu thay đổi theo quý do tự doanh — đọc 4–8 quý trước khi xếp
  nhóm.
- Chi phí vốn của CTCK không công bố đồng nhất: phép so spread mang tính ước lượng,
  ghi rõ là ước tính.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chứng khoán còn dư địa tăng trưởng không?
Đạt khi: có dư nợ margin ngành + nguồn, mức đòn bẩy của mã so trần, spread margin
nở/nén, cơ cấu doanh thu 4 mảng, và verdict theo cây Q1→Q5 kèm nhánh dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
stacked doanh thu theo 4 mảng, multiline dư nợ margin của nhóm, bar mức đòn bẩy
các mã. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết quả
`financial_detail`/`peer_compare` đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần đúng dòng BCTC công ty chứng khoán trong `vs_financial_norms(btype=2)`, cách tính mức đòn bẩy, ngưỡng diễn giải |
