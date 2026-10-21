---
name: chung-khoan-vn
description: "Đọc ngành chứng khoán VN: dư nợ margin so trần, tự doanh, môi giới, vốn chủ và cơ chế thị trường mới. Dùng khi hỏi nhóm công ty chứng khoán hay kết quả một CTCK."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_statements, financial_ratios, valuation_run, planned_targets, analyst_consensus, peer_compare, vs_market_info, breadth_scan, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành chứng khoán, nhóm công ty chứng khoán, cổ phiếu chứng khoán, kết quả ctck, dư nợ margin, cho vay ký quỹ, mảng môi giới, phí môi giới, mảng tự doanh]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán, mở tài khoản]
version: 1.0.0
---

# Chứng khoán Việt Nam — framework phân tích

Lợi nhuận công ty chứng khoán (CTCK) VN đến từ ba nguồn khác hẳn nhau: **cho vay ký
quỹ** (thu lãi theo dư nợ, khá đều), **tự doanh** (lãi/lỗ danh mục, biến động mạnh
nhất) và **phí** (môi giới bị cạnh tranh phí kéo giảm, tư vấn – bảo lãnh theo
thương vụ). Skill này đọc ngành qua dư nợ margin so với trần, chất lượng nguồn lãi
và vốn chủ — không đọc bằng doanh thu môi giới. BCTC CTCK theo mẫu riêng: tra tên
dòng bằng `vs_financial_norms(btype=2)`.

## Khi nào dùng

- Dùng khi: hỏi nhóm CTCK đang được tiếp sức hay bị siết, kết quả một CTCK, dư nợ
  margin có rủi ro không, ngành hưởng gì từ nâng hạng hay cơ chế mới.
- Khi KHÔNG dùng:
  - Pha thị trường, chứng khoán có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Tin chứng khoán trong ngày → `tin-tuc-nong-viet-nam`.
  - Biên độ, bước giá, cách sàn vận hành → `vn-market-basics`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Dư nợ cho vay ký quỹ | Nguồn lãi đều nhất: thu lãi theo dư nợ. Dư nợ tăng theo thanh khoản và khẩu vị vay của nhà đầu tư; giảm đột ngột khi thị trường bị bán mạnh hoặc CTCK siết cho vay | Của mã: `financial_detail(statement=CDKT)` (các khoản cho vay); toàn ngành: `web_search` (tổng hợp theo quý, ghi nguồn + kỳ) |
| Mức sử dụng trần cho vay | Tổng dư nợ ký quỹ bị giới hạn theo vốn chủ sở hữu. Gần trần thì muốn tăng cho vay phải tăng vốn | Tự tính dư nợ cho vay / vốn chủ (CDKT); trần theo văn bản hiện hành tra bằng `web_search` |
| Tự doanh | Lãi/lỗ tài sản tài chính (FVTPL, AFS) theo thị trường; lợi nhuận một quý có thể chủ yếu từ đây và không lặp lại | `financial_detail(statement=KQKD)`: lãi/lỗ từ tài sản tài chính; CDKT: quy mô danh mục FVTPL/AFS/HTM |
| Phí môi giới và tư vấn | Môi giới bám thanh khoản nhưng bị cạnh tranh phí kéo biên; tư vấn, bảo lãnh theo số thương vụ IPO/phát hành | KQKD: doanh thu môi giới, bảo lãnh, tư vấn; thanh khoản sàn: `vs_market_info`, `breadth_scan` |
| Chi phí vốn | CTCK vay ngân hàng và phát hành trái phiếu để cho vay ký quỹ; chi phí vay tăng nhanh hơn lãi cho vay thì biên mảng này nén | KQKD: chi phí lãi vay; CDKT: vay ngắn hạn, trái phiếu phát hành |
| Cơ chế thị trường | Nâng hạng thị trường, giao dịch không cần ký quỹ trước, hệ thống giao dịch mới, đối tác bù trừ trung tâm: thay đổi dòng vốn ngoại, nhu cầu vốn và nghiệp vụ của CTCK | `web_search` — ghi mốc thời gian và văn bản từng cơ chế |

## Các bước

Khoảng 4 lượt. `financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được
thì dùng `financial_statements` và ghi rõ.

**Bước 1 (song song):** `vs_financial_norms(btype=2)` · `symbol_lookup` nếu cần ·
`vn_company` (CTCK thuộc ngân hàng, nước ngoài hay độc lập).

**Bước 2 (song song):** `financial_detail(symbol, statement=CDKT)` (các khoản cho vay,
tài sản tài chính, vay, vốn chủ) · `financial_detail(symbol, statement=KQKD)` (doanh
thu từng mảng, lãi/lỗ tài sản tài chính, chi phí lãi vay), 4–8 quý. Tự tính tỷ trọng
lợi nhuận theo nguồn và dư nợ / vốn chủ, ghi rõ công thức.

**Bước 3 (song song):** `web_search` (dư nợ margin toàn ngành, trần cho vay theo văn
bản hiện hành, mốc cơ chế mới) · `vs_market_info` (thanh khoản từng sàn) ·
`news_symbol(symbol)` (tăng vốn, phát hành của riêng CTCK).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với CTCK cùng mô hình: chỉ báo
vận hành đọc bằng `financial_detail` từng mã (tối đa 3); `peer_compare` chỉ trả P/E,
P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định CTCK đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Lợi nhuận kỳ gần nhất đến chủ yếu từ đâu?
├─ Tự doanh (lãi tài sản tài chính) là phần lớn → ★ "Lợi nhuận phụ thuộc thị
│  trường: kỳ sau có thể đảo chiều cùng danh mục, không nội suy thành năng lực"
├─ Cho vay ký quỹ và phí → tiếp Q2
└─ Chưa tách được nguồn → tiếp Q2, ghi rõ

Q2. Dư nợ ký quỹ (của mã và toàn ngành) đang tăng hay giảm?
├─ Giảm rõ qua 2 quý → ★ "Mảng cho vay đang co: lãi từ ký quỹ sẽ giảm theo, thanh
│  khoản thị trường là biến cần theo dõi"
├─ Tăng → tiếp Q3
└─ Không có số toàn ngành → tiếp Q3 chỉ với số của mã

Q3. Dư nợ / vốn chủ còn cách trần bao xa?
├─ Sát trần → ★ "Tăng trưởng cho vay bị chặn bởi vốn: cần tăng vốn — tra kế hoạch
│  phát hành"
├─ Còn xa → tiếp Q4
└─ Chưa xác nhận được trần hiện hành → tiếp Q4, ghi "chưa xác nhận trần"

Q4. Chi phí vốn so với lãi cho vay ký quỹ?
├─ Chi phí lãi vay tăng nhanh hơn thu lãi cho vay → ★ "Biên mảng ký quỹ đang nén:
│  dư nợ tăng nhưng lãi không theo"
└─ Ổn hoặc cải thiện → ★ "Được tiếp sức: cho vay còn chỗ, biên giữ được; phần
   tự doanh vẫn là biến động riêng"

## Chỉ báo đặc thù ngành

Tên dòng theo statement, công thức tự tính và cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

CTCK định giá bằng **P/B neo ROE**: `valuation_run(symbol, btype=2)` cho vùng P/B. So
trong nhóm cùng mô hình (thuộc ngân hàng / nước ngoài / độc lập). ROE của năm có lãi
tự doanh lớn cần giảm trọng số — ghi rõ chất lượng lãi trước khi dùng P/E.

## Rủi ro đặc thù

- Thị trường giảm mạnh làm cùng lúc: dư nợ co, tự doanh lỗ, phí giảm.
- Dư nợ tập trung vào ít mã: một mã giảm sàn liên tiếp có thể thành nợ khó đòi.
- Danh mục trái phiếu doanh nghiệp trong tự doanh mang rủi ro tín dụng của tổ chức phát hành.
- Cạnh tranh phí môi giới là xu hướng cấu trúc, không phải chu kỳ.

## Ranh giới

- Không xác định pha thị trường, không nói "chứng khoán sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu trần cho vay, tỷ lệ an toàn tài chính hay mốc cơ chế từ trí nhớ: tra văn
  bản hiện hành, ghi số hiệu + ngày (luật này chỉ nằm ở đây).
- Không suy dư nợ toàn ngành từ một CTCK.

## Giới hạn

- Số toàn ngành tổng hợp theo quý, có độ trễ — ghi kỳ.
- Lãi suất cho vay ký quỹ từng gói không có trong BCTC; lãi suất bình quân tự tính từ
  thu lãi / dư nợ bình quân chỉ là ước lượng.

## Ví dụ

Hỏi: Ngành chứng khoán còn dư địa tăng trưởng không?
Đạt khi: tách được nguồn lợi nhuận, có dư nợ của mã + toàn ngành kèm nguồn, dư nợ /
vốn chủ so trần đã tra văn bản, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột chồng lợi nhuận theo nguồn
từng quý, đường dư nợ cho vay, cột dư nợ / vốn chủ các CTCK. Vẽ bằng `chart_render` với
`from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có; cần chọn loại hình thì
nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần tên dòng BCTC CTCK theo statement, công thức tỷ trọng nguồn lãi và dư nợ / vốn chủ |
