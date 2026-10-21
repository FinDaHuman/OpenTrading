---
name: bat-dong-san-vn
description: "Đọc ngành BĐS VN: dòng vốn (tín dụng, trái phiếu, tiền khách trả trước), pháp lý dự án, nhà ở vs khu công nghiệp. Dùng khi hỏi nhóm BĐS hay một chủ đầu tư."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bất động sản, nhóm bất động sản, cổ phiếu bất động sản, doanh nghiệp bất động sản, chủ đầu tư bất động sản, bất động sản công nghiệp, bất động sản khu công nghiệp, nhà ở thương mại, quỹ đất dự án]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Bất động sản Việt Nam — framework phân tích

BĐS VN là ngành **dòng vốn + pháp lý**. Dự án sống bằng bốn nguồn vốn (tín dụng ngân
hàng, trái phiếu doanh nghiệp, vốn chủ, tiền khách hàng trả trước), và mỗi nguồn có
rào riêng. Ngành gồm hai chu kỳ khác nhau: **nhà ở thương mại** (lãi vay mua nhà,
khả năng hấp thụ, pháp lý dự án) và **khu công nghiệp** (dòng vốn FDI, giá thuê, quỹ
đất sạch). Doanh thu BĐS ghi nhận theo đợt bàn giao, nên một quý đơn lẻ nói rất ít.

## Khi nào dùng

- Dùng khi: hỏi nhóm BĐS đang được tiếp sức hay bị siết, một chủ đầu tư có bị siết
  vốn không, nhà ở và khu công nghiệp khác nhau thế nào, áp lực trái phiếu đáo hạn.
- Khi KHÔNG dùng:
  - Pha thị trường, BĐS có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Tập đoàn Vingroup và các công ty thành viên → `vingroup-vn`.
  - Quyết định mua nhà để ở, so mua nhà với gửi tiết kiệm → không thuộc skill này.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Tín dụng cho BĐS | Ngân hàng siết hay nới cho vay dự án và cho vay mua nhà quyết định dòng tiền vào dự án và sức mua | Toàn ngành: `web_search` (số theo kỳ, ghi nguồn); của mã: vay và nợ thuê tài chính (CDKT), chi phí lãi vay (KQKD) |
| Trái phiếu doanh nghiệp | Phát hành dễ thì dự án đi nhanh; đáo hạn tập trung vào vài quý là điểm nghẽn; lãi phát hành tăng là thị trường đòi bù rủi ro cao hơn | Của mã: thuyết minh trái phiếu (TM) + `news_symbol`; toàn ngành: `web_search` |
| Tiền khách hàng trả trước | Vốn rẻ nhất của chủ đầu tư; tăng đều là bán hàng tốt, giảm báo trước doanh thu sẽ yếu | CDKT: người mua trả tiền trước (ngắn + dài hạn), doanh thu chưa thực hiện |
| Pháp lý dự án | Phê duyệt chủ trương, giao đất, tiền sử dụng đất theo bảng giá đất, điều kiện vốn chủ tối thiểu theo quy mô dự án: chậm một bước là chi phí tài chính đội lên | Văn bản hiện hành (Luật Đất đai, Luật Kinh doanh BĐS, nghị định hướng dẫn): `web_search`, ghi số hiệu + ngày; sự kiện dự án: `company_events`, `news_symbol` |
| Phân khúc | Nhà ở: lãi vay mua nhà, nguồn cung mới, giá bán. Khu công nghiệp: FDI đăng ký/giải ngân, giá thuê, diện tích cho thuê mới | `web_search` (báo cáo thị trường theo kỳ); của mã: doanh thu theo mảng (TM) |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo mảng, chi tiết trái phiếu, hàng tồn kho theo dự án).
Xác định **phân khúc đóng góp lợi nhuận lớn nhất**; cây đi theo phân khúc đó, các
mảng còn lại nêu ở phần rủi ro.

**Bước 2 (song song):** `financial_detail(symbol, statement=CDKT)` (vay, người mua trả
tiền trước, hàng tồn kho, vốn chủ) · `financial_detail(symbol, statement=KQKD)` (doanh
thu, giá vốn, chi phí lãi vay), 4–8 quý.

**Bước 3 (song song):** `web_search` (tín dụng BĐS, trái phiếu đáo hạn toàn ngành,
văn bản pháp lý đang áp dụng, báo cáo thị trường nhà ở / KCN) · `company_events(symbol)`
+ `news_symbol(symbol)` (phê duyệt, mở bán, phát hành, tăng vốn).

**Bước 4:** `planned_targets` (kế hoạch doanh thu, lợi nhuận) · `analyst_consensus`. So
với chủ đầu tư cùng phân khúc: chỉ báo vận hành đọc bằng `financial_detail` từng mã
(tối đa 3); `peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định chủ đầu tư đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Phân khúc đóng góp lợi nhuận lớn nhất?
├─ Nhà ở thương mại → tiếp Q2
├─ Khu công nghiệp → tiếp Q4
└─ Cho thuê bán lẻ, văn phòng, nghỉ dưỡng → ★ "Chu kỳ bám tỷ lệ lấp đầy và giá
   thuê: đọc lấp đầy, giá thuê và nợ vay; không áp logic bán nhà"

Q2 (nhà ở). Dòng vốn vào dự án đang chảy không?
├─ Tín dụng BĐS chậm lại, phát hành trái phiếu khó hoặc lãi phát hành tăng → ★
│  "Bị siết bởi vốn: đọc lịch đáo hạn và chi phí lãi vay trước khi nhìn doanh thu"
├─ Tín dụng và trái phiếu đang nới → tiếp Q3
└─ Không tra được số toàn ngành → tiếp Q3, chỉ dựa số của mã

Q3 (nhà ở). Nợ đến hạn và pháp lý dự án có chặn không?
├─ Trái phiếu/vay đến hạn tập trung trong 4 quý tới vượt tiền mặt, hoặc dự án chính
│  đang vướng pháp lý → ★ "Bị siết bởi tái cấp vốn hoặc pháp lý: bán hàng tốt cũng
│  chưa thành tiền kịp"
└─ Không → tiếp Q5

Q4 (khu công nghiệp). Cầu thuê đất còn kéo không?
├─ Diện tích cho thuê mới và giá thuê đang tăng → tiếp Q5
├─ Cho thuê mới chững, giá thuê phẳng → ★ "Bị siết bởi cầu thuê: đọc quỹ đất sạch
│  và tiến độ FDI trước khi tin kế hoạch"
└─ Không có số thị trường → tiếp Q5

Q5 (chung). Bán hàng có đang thành dòng tiền không?
├─ Người mua trả tiền trước tăng, biên lãi gộp giữ được → ★ "Được tiếp sức: bán
│  hàng đang chuyển thành doanh thu thật"
├─ Người mua trả tiền trước tăng nhưng biên giảm → ★ "Tăng trưởng nhờ chiết khấu
│  giá: hạ độ tin cậy cho biên các kỳ tới"
├─ Người mua trả tiền trước giảm, chi phí lãi vay tăng → ★ "Bị siết: bán chậm cộng
│  chi phí vốn tăng là cấu trúc rủi ro nhất của ngành"
└─ Chưa đủ số để kết luận → ★ "Chưa đủ dữ liệu bán hàng: kết luận chỉ dựa dòng vốn
   và pháp lý, độ tin cậy thấp"

## Chỉ báo đặc thù ngành

Tên dòng theo statement và cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

BĐS định giá bằng **giá trị tài sản ròng (RNAV)** theo quỹ đất và dự án, đối chiếu
**P/B**; P/E nhảy theo tiến độ bàn giao nên chỉ dùng khi kèm doanh thu chưa ghi nhận.
Chỉ so trong cùng phân khúc: P/B nhà ở với khu công nghiệp không so được. RNAV cần
giả định giá bán và tiến độ — ghi rõ giả định, không đưa thành giá mục tiêu.

## Rủi ro đặc thù

- Trái phiếu đáo hạn tập trung và lãi phát hành tăng thường xuất hiện trước khi
  doanh thu giảm.
- Pháp lý dự án và tiền sử dụng đất: một bước chậm làm chi phí vốn tích lại.
- Nguồn cung mới đổ về cùng lúc buộc chiết khấu, biên giảm dù doanh thu tăng.
- Khu công nghiệp phụ thuộc dòng FDI và chính sách thương mại của nước nhà đầu tư.

## Ranh giới

- Không xác định pha thị trường, không nói "BĐS sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán; không tư vấn mua nhà để ở.
- Không nêu điều kiện vốn chủ, trần dư nợ hay bảng giá đất từ trí nhớ: tra văn bản
  hiện hành, ghi số hiệu + ngày (luật này chỉ nằm ở đây).

## Giới hạn

- Số tín dụng và trái phiếu toàn ngành có độ trễ — ghi kỳ.
- Giá trị bán hàng (hợp đồng ký) không phải dòng BCTC; "người mua trả tiền trước"
  chỉ là phần khách đã trả.
- Biên lãi gộp nhảy theo dự án bàn giao — đọc 4 quý trước khi nói xu hướng.

## Ví dụ

Hỏi: Chủ đầu tư bất động sản có bị siết vốn không?
Đạt khi: nêu phân khúc chính, có số tín dụng/trái phiếu kèm nguồn, nợ đến hạn so tiền
mặt, người mua trả tiền trước 4 quý, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường người mua trả tiền trước
và doanh thu theo quý, cột nợ đến hạn theo quý so với tiền mặt, cột biên lãi gộp. Vẽ
bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết quả `financial_detail` đã có;
cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần tên dòng BCTC BĐS theo statement, cách đọc người mua trả tiền trước, tồn kho dự án, nợ đến hạn |
