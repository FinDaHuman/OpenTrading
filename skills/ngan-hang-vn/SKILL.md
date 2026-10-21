---
name: ngan-hang-vn
description: "Đọc ngành ngân hàng VN: tín dụng và room, NIM, CASA, chất lượng tài sản (nhóm nợ, bao phủ), chuẩn mực an toàn. Dùng khi hỏi nhóm ngân hàng hay đọc BCTC ngân hàng."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_statements, financial_ratios, valuation_run, planned_targets, analyst_consensus, peer_compare, sbv_rates, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành ngân hàng, nhóm ngân hàng, cổ phiếu ngân hàng, bctc ngân hàng, chất lượng tài sản ngân hàng, nợ nhóm 2, nim ngân hàng, tỷ lệ casa, room tín dụng, hạn mức tín dụng, thanh khoản ngân hàng]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Ngân hàng Việt Nam — framework phân tích

Ngân hàng đọc bằng chỉ báo của chính ngành: tín dụng tăng được bao nhiêu, mỗi đồng
tín dụng lãi bao nhiêu (NIM, chi phí vốn), rủi ro đi kèm (nợ xấu, nợ nhóm 2, bao phủ,
ngoại bảng) và khung an toàn đang siết hay nới. BCTC ngân hàng theo mẫu riêng của
tổ chức tín dụng: tra tên dòng bằng `vs_financial_norms(btype=3)`, không dùng tên
dòng của doanh nghiệp thường (không có "doanh thu", "lãi gộp").

## Khi nào dùng

- Dùng khi: hỏi nhóm ngân hàng đang được tiếp sức hay bị siết, một ngân hàng nên
  xem chỉ tiêu gì, chất lượng tài sản, NIM/CASA (`ngân hàng đang thế nào`, `BCTC
  ngân hàng đọc gì`, `NIM ngân hàng đang thế nào`).
- Khi KHÔNG dùng:
  - Pha thị trường, ngân hàng có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - So vài mã ngân hàng theo chỉ số → `so-sanh-cung-nganh`.
  - Lãi suất điều hành, tín dụng toàn nền kinh tế → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Tăng trưởng tín dụng | Tín dụng là "khối lượng" của ngân hàng. Khi NHNN còn phân bổ hạn mức (room) theo từng ngân hàng, tăng trưởng bị chặn hành chính; khi cơ chế này nới hoặc bỏ, giới hạn chuyển sang vốn và các tỷ lệ an toàn | `financial_detail(statement=CDKT)`: Cho vay khách hàng; cơ chế + hạn mức năm đang xét: `web_search` (ghi văn bản, ngày) |
| NIM và chi phí vốn | NIM = thu nhập lãi thuần / tài sản sinh lãi bình quân. Chi phí vốn lên nhanh hơn lợi suất tài sản thì NIM nén | KQKD: Thu nhập lãi và các khoản thu nhập tương tự, Chi phí lãi và các chi phí tương tự, Thu nhập lãi thuần; CDKT: tài sản sinh lãi |
| CASA | Tiền gửi không kỳ hạn là vốn rẻ, đệm cho NIM khi lãi huy động tăng | `financial_detail(statement=TM)`: cơ cấu tiền gửi theo loại |
| Chất lượng tài sản 3 lớp | Nợ xấu (nhóm 3–5) là chuyện đã xảy ra; nợ nhóm 2 tăng khi nợ xấu còn phẳng là rủi ro đang hình thành; tỷ lệ bao phủ giảm là đệm mỏng đi. Đọc cả 3 lớp cùng lúc | `financial_detail(statement=TM)`: phân loại nợ nhóm 1–5; CDKT: dự phòng rủi ro cho vay khách hàng; KQKD: chi phí dự phòng rủi ro tín dụng |
| Ngoại bảng | Bảo lãnh, thư tín dụng, cam kết cho vay không nằm trong dư nợ và dự phòng đã báo cáo | `financial_detail(statement=TM)`: các cam kết ngoại bảng (nếu kỳ có công bố) |
| Chuẩn mực an toàn | Tỷ lệ cho vay/huy động (LDR), vốn ngắn hạn cho vay trung dài hạn, CAR, các tỷ lệ thanh khoản theo lộ trình mới. Gần trần thì tăng trưởng phải chậm lại hoặc phải tăng vốn | Văn bản hiện hành + lộ trình: `web_search`; CAR do ngân hàng công bố (thuyết minh/báo cáo thường niên) |

## Các bước

Khoảng 4 lượt. `financial_detail` nhận **một** `statement` mỗi lời gọi (KQKD, CDKT,
LCTT, TM); không gọi được thì dùng `financial_statements` và ghi rõ là bản rút gọn.

**Bước 1 (song song):** `vs_financial_norms(btype=3)` (tên dòng chuẩn) · `symbol_lookup`
nếu user đưa tên · `vn_company` (ngân hàng quốc doanh / tư nhân lớn / nhỏ).

**Bước 2 (song song, 3 lời gọi):** `financial_detail(symbol, statement=KQKD)` ·
`financial_detail(symbol, statement=CDKT)` · `financial_detail(symbol, statement=TM)`,
4–8 kỳ. Tự tính NIM, lợi suất tài sản, chi phí vốn, tỷ lệ nợ xấu, nợ nhóm 2, bao phủ
(công thức ở `references/kpi.md`) và ghi rõ là tự tính.

**Bước 3 (song song):** `web_search` cho cơ chế/hạn mức tín dụng năm đang xét và văn
bản an toàn đang áp dụng (ghi số hiệu + ngày) · `sbv_rates` (lãi suất điều hành) ·
`news_symbol(symbol)` cho tin riêng ngân hàng (tăng vốn, xử lý nợ, nhận chuyển giao).
`news_market` chỉ là luồng tin mới nhất, không tra được theo chủ đề.

**Bước 4:** `planned_targets` (kế hoạch năm) · `analyst_consensus` (kỳ vọng của CTCK,
không thay kết luận). So với ngân hàng cùng nhóm: NIM/nợ xấu/CASA của peer đọc bằng
`financial_detail` từng mã (tối đa 3 mã); `peer_compare` chỉ trả P/E, P/B, EPS, BVPS,
ROE/ROA.

## Cây quyết định ngân hàng đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy
thấp, không bù số.

Q1. Tín dụng năm nay còn chỗ tăng không?
├─ Còn hạn mức, hoặc cơ chế hạn mức đã bỏ (có văn bản) và các tỷ lệ an toàn còn
│  xa trần → tiếp Q2
├─ Đã dùng gần hết hạn mức, hoặc tỷ lệ an toàn sát trần → ★ "Tăng trưởng tín
│  dụng bị chặn: lợi nhuận năm nay phải đến từ NIM, thu ngoài lãi và chi phí dự
│  phòng"
└─ Không tra được hạn mức/cơ chế → tiếp Q2, ghi "chưa xác nhận room"

Q2. NIM đang giãn hay nén?
├─ Nén vì chi phí vốn tăng nhanh hơn lợi suất tài sản → ★ "Bị siết bởi chi phí
│  vốn: lợi thế thuộc ngân hàng có CASA cao và vốn rẻ"
├─ Nén vì lợi suất tài sản giảm (giảm lãi cho vay, cơ cấu sang khoản vay rẻ) →
│  ★ "NIM bị nén từ phía tài sản: tăng trưởng tín dụng chưa chuyển thành lợi
│  nhuận tương ứng"
└─ Giãn hoặc đi ngang → tiếp Q3

Q3. Ba lớp chất lượng tài sản có cùng chiều không?
├─ Cả nợ xấu, nợ nhóm 2 và bao phủ cùng xấu đi → ★ "Bị siết bởi chất lượng tài
│  sản: chi phí dự phòng sẽ ăn vào tăng trưởng lợi nhuận"
├─ Nợ xấu phẳng nhưng nợ nhóm 2 tăng hoặc bao phủ giảm → ★ "Rủi ro đang hình
│  thành trước khi lên nợ xấu: hạ độ tin cậy cho dự báo lợi nhuận"
└─ Cả 3 lớp ổn hoặc cải thiện → tiếp Q4

Q4. Ngoại bảng có tăng nhanh hơn dư nợ trên bảng không?
├─ Có → ★ "Rủi ro ngoài bảng đang lớn lên: tính cả ngoại bảng khi so với ngân
│  hàng cùng nhóm"
└─ Không, hoặc kỳ này không công bố → ★ "Được tiếp sức: tín dụng còn chỗ, NIM
   giữ được, chất lượng tài sản ổn" (ghi rõ nếu ngoại bảng chưa đọc được)

## Chỉ báo đặc thù ngành

Tên dòng, công thức tự tính và cách đọc từng tỷ lệ ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Ngân hàng định giá bằng **P/B neo ROE**: cùng P/B, ngân hàng ROE cao hơn đáng giá
hơn. Vùng giá: `valuation_run(symbol, btype=3)` (P/B cho ngân hàng). So P/B trong
nhóm ROE tương đương. Lợi nhuận đột biến một lần (thoái vốn, hoàn nhập dự phòng)
làm P/E và ROE kỳ đó mất ý nghĩa — ghi rõ thay vì tính fair value từ đó.

## Rủi ro đặc thù

- Nợ xấu là chỉ báo trễ; nợ nhóm 2 và bao phủ đi trước.
- Tái cơ cấu nợ, giãn hoãn theo chính sách làm nợ xấu báo cáo thấp hơn thực tế.
- Tập trung cho vay vào một ngành (BĐS, một nhóm khách hàng) biến chu kỳ ngành đó
  thành rủi ro của ngân hàng.
- Nhận chuyển giao/tái cơ cấu ngân hàng yếu: có thể kèm ưu đãi room nhưng cũng kèm
  gánh nặng vốn.

## Ranh giới

- Không xác định pha thị trường, không nói "ngân hàng sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán, không đặt tỷ trọng.
- Không nêu trần, tỷ lệ hay lộ trình pháp lý từ trí nhớ: tra văn bản hiện hành,
  ghi số hiệu + ngày; tra không ra thì nói "chưa xác nhận" (luật này chỉ nằm ở đây).

## Giới hạn

- Room tín dụng không công bố đều cho mọi ngân hàng; nợ nhóm 2, CASA, ngoại bảng
  không phải kỳ nào cũng có trong thuyết minh — ghi rõ kỳ thiếu, không nội suy.
- LDR theo quy định có công thức riêng; cho vay/tiền gửi khách hàng tự tính chỉ là
  ước lượng.

## Ví dụ

Hỏi: Ngân hàng đang bị siết bởi cái gì?
Đạt khi: có trạng thái room/chuẩn mực kèm nguồn, NIM tự tính 4 kỳ (ghi công thức),
3 lớp chất lượng tài sản cùng kỳ, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột chồng thu nhập lãi
thuần/ngoài lãi theo quý, đường NIM theo quý, cột nợ xấu – nợ nhóm 2 – bao phủ. Vẽ
bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết quả `financial_detail`
đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần tên dòng BCTC ngân hàng theo từng statement, công thức NIM/bao phủ/nợ nhóm 2 và cách đọc |
