---
name: ngan-hang-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành ngân hàng VN theo bộ chỉ báo riêng: hạn mức tín dụng, NIM và spread lãi, chất lượng tài sản 3 lớp, ngoại bảng và chuẩn mực thanh khoản. Dùng khi hỏi xu hướng nhóm ngân hàng hoặc đọc BCTC ngân hàng."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, financial_statements, stock_overview, planned_targets, sbv_rates, analyst_consensus, peer_compare, compare_equities, news_symbol, news_market, dividends_splits, symbol_lookup, vn_company, valuation_run]
triggers:
  keywords: [ngành ngân hàng, nhóm ngân hàng, nợ nhóm 2 ngân hàng, NIM ngân hàng, CASA ngân hàng, NPL ngân hàng, biên lãi thuần ngân hàng, room tín dụng, hạn mức tín dụng, trần ldr, thanh khoản ngân hàng]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Ngân hàng Việt Nam — framework phân tích

Skill đọc ngành ngân hàng bằng **chỉ báo của ngành ngân hàng**: dòng tiền tăng
trưởng (hạn mức tín dụng), chất lượng dòng tiền đó (spread), rủi ro của nó
(chất lượng tài sản 3 lớp + ngoại bảng) và khung siết/nới (thanh khoản, chuẩn
mực). BCTC ngân hàng đọc qua chuẩn mực riêng của loại hình (`vs_financial_norms`
với báo cáo loại ngân hàng), không đọc bằng bộ dòng CTCP chung.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm ngân hàng, chỉ tiêu một ngân hàng nên xem gì,
  chất lượng tài sản, hay ngành đang được tiếp sức hay bị siết (`ngân hàng đang
  thế nào`, `NPL của VCB`, `tăng trưởng tín dụng ảnh hưởng gì`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã (kỹ thuật + định giá + tin) → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã (fair value, vùng P/B) → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành (M-Score, cổ đông) → `co-ban-chuyen-sau`.
  - Số liệu vĩ mô VN chi tiết (GDP, lãi suất điều hành) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đo/xác minh bằng |
|---|---|---|
| Hạn mức tín dụng | Nếu cơ chế hạn mức áp dụng tại kỳ phân tích, đối chiếu hạn mức và tăng trưởng thực tế từng ngân hàng; phân bổ theo kỳ hoặc nhiệm vụ tái cơ cấu chỉ được dùng khi có nguồn xác nhận. Không mặc định hạn mức theo quý hay mùa vụ tăng trưởng | Xác minh cơ chế hạn mức có áp dụng tại kỳ phân tích; tăng trưởng tín dụng YTD của mã so hạn mức được công bố: `financial_detail` (theo dòng BCTC ngân hàng) + phân phối hạn mức trong `news_market`/`web_search`. Ghi rõ hạn mức đọc từ đâu |
| Spread lãi thuần | Thu nhập lãi thuần = thu nhập lãi − chi phí lãi; NIM khác spread lợi suất tài sản trừ chi phí vốn vì hai chỉ tiêu có mẫu số khác nhau. Khi chi phí huy động (giấy tờ có giá, tiền gửi kỳ hạn) lên nhanh hơn tỷ suất cho vay → spread nén; ngân hàng giữ được nhóm khách hàng ít nhạy giá và cơ cấu vốn rẻ thì nén ít hơn | `financial_detail`: thu nhập lãi, chi phí lãi và thu nhập lãi thuần theo quý + cơ cấu huy động; `sbv_rates` cho trần lãi huy động điều hành |
| CASA | Cơ cấu vốn không kỳ hạn là đệm chi phí vốn: nhóm khách hàng bán lẻ càng lớn, spread càng giữ được | Cơ cấu nguồn vốn trong `financial_detail` (chuẩn mực ngân hàng); so với nhóm cùng phân khúc bằng `financial_detail`/thuyết minh từng ngân hàng, cùng kỳ |
| Chất lượng tài sản 3 lớp | Nợ xấu chỉ là lớp trên cùng. Nợ nhóm 2 (cần chú ý) tăng trong khi nợ xấu phẳng = rủi ro đang hình thành nhưng chưa lên báo cáo; tỷ lệ bao phủ rủi ro giảm = đệm provision đang mỏng. Đọc **3 lớp cùng lúc** mới có kết luận | `financial_detail`: tỷ lệ nợ xấu, tỷ lệ nợ nhóm 2, tỷ lệ bao phủ nợ xấu, chi phí rủi ro tín dụng — mỗi quý, kèm xu hướng QoQ |
| Ngoại bảng | Tín dụng tương đương ngoại bảng (bảo lãnh, cam kết) không nằm trong nợ xấu và dự phòng đã công bố → rủi ro thật lớn hơn bảng | `financial_detail` dòng ngoại bảng nếu kỳ báo cáo có; số tổng hợp ngành lấy từ `news_market`/`web_search`, ghi rõ nguồn và kỳ |
| Thanh khoản + chuẩn mực | Tín dụng tăng nhanh hơn tiền gửi có thể tạo áp lực huy động. LDR, CAR, LCR/NSFR có định nghĩa và phạm vi áp dụng khác nhau; không giả định Basel III thay thế hoặc miễn LDR khi chưa có văn bản áp dụng cho ngân hàng và kỳ phân tích | Xác nhận bằng văn bản: tra `news_market`/`web_search` để lấy **số hiệu văn bản + ngày hiệu lực + trần/lộ trình đang áp dụng**, rồi ghi nguồn trong câu trả lời. **Không suy ngưỡng mới từ trí nhớ** — nếu chưa tra được văn bản, nói "chưa xác nhận", không đoán |

## Các bước

Khoảng 4 lượt gọi tool. Bắt buộc có `vs_financial_norms(btype=3)` TRƯỚC khi đọc dòng
BCTC ngân hàng — dùng dòng chuẩn ngành thay vì đoán tên dòng CTCP chung.

**Bước 1: Chuẩn mực + một mã làm gốc (song song).**

`vs_financial_norms(btype=3)` (dòng BCTC ngân hàng) · `symbol_lookup` (nếu user
đưa tên công ty) · `vn_company` (hồ sơ, mô hình). Thiếu hạn mức tín dụng công bố
→ ghi "không lấy được hạn mức", không đoán.

**Bước 2: Đọc 3 lớp chất lượng tài sản + spread (song song — 3 lời gọi `financial_detail`, mỗi lời gọi MỘT `statement`).**

`financial_detail` chỉ nhận **một** `statement` mỗi lời gọi (mặc định `KQKD`) nên phải
gọi riêng, gom song song trong một lượt:

- `financial_detail(symbol, statement=KQKD)`: thu nhập lãi, chi phí lãi và thu nhập lãi thuần · chi phí rủi ro
  tín dụng · lãi thuần ngoài lãi → phục vụ đọc spread.
- `financial_detail(symbol, statement=CDKT)`: cho vay khách hàng · tiền gửi · tài sản sinh lãi ·
  vốn chủ sở hữu → phục vụ đọc tăng trưởng, khoảng cách tín dụng − tiền gửi và đòn bẩy.
- `financial_detail(symbol, statement=TM)`: nợ xấu · nợ nhóm 2 · tỷ lệ bao phủ nợ xấu ·
  ngoại bảng → phục vụ **3 lớp chất lượng tài sản** (các chỉ tiêu này nằm ở thuyết minh,
  không nằm trong KQKD).

So QoQ/YoY từng chỉ tiêu, ghi số + kỳ + `statement` nào ra số đó.

**Bước 3: Bối cảnh vốn + chuẩn mực (song song).**

`sbv_rates` (chế độ lãi suất điều hành) · `news_market` (phân phối hạn mức tín
dụng, văn bản chuẩn mực mới, điều chỉnh room). Ghi rõ số nào từ tool nào.

**Bước 4: Neo kỳ vọng + vị thế trong nhóm.**

`planned_targets` (kế hoạch năm của mã) · `peer_compare` (chỉ số tổng quan thực trả như P/B, ROE; không có NIM/CASA/NPL) · `financial_detail` và công bố từng peer để so NIM/CASA/NPL cùng kỳ · `analyst_consensus` (neo quan điểm CTCK — làm kỳ vọng,
không thay thế kết luận).

## Cây quyết định ngành đang tiếp sức hay siết

Duyệt các node theo thứ tự; ghi trạng thái trung gian rồi đi tiếp. Chỉ dừng ở ★.
Thiếu dữ liệu phải ghi rõ và hạ độ tin cậy; không coi thiếu là tín hiệu xấu.

Q1. Hạn mức tín dụng có áp dụng, được công bố và còn dư địa không?
├─ Còn dư địa → ghi tăng trưởng tín dụng còn chỗ → Q2
├─ Đã hết/gần hết → ghi hạn chế tăng trưởng, cần xét spread/phí → Q2
├─ Cơ chế không áp dụng tại kỳ phân tích (có nguồn xác nhận) → ghi không dùng hạn mức làm rào cản → Q2
└─ Chưa công bố/chưa xác nhận cơ chế → ghi chưa biết dư địa, hạ độ tin cậy → Q2

Q2. NIM và spread lãi đang giãn hay nén, với kỳ và mẫu số tương thích?
├─ Nén → ghi áp lực biên → Q3
├─ Giãn/đi ngang → ghi trạng thái biên → Q4
└─ Thiếu thu nhập hoặc tài sản sinh lãi bình quân → ghi chưa tính được NIM → Q4

Q3. Nguyên nhân nén là gì?
├─ Chi phí vốn tăng/CASA giảm → ghi rủi ro chi phí vốn → Q4
├─ Lợi suất tài sản giảm/cơ cấu tài sản thay đổi → ghi áp lực lợi suất; chưa suy là nợ xấu → Q4
└─ Chưa tách được → ghi chưa rõ nguyên nhân → Q4

Q4. Nợ xấu, nợ nhóm 2 và bao phủ nợ xấu có cùng chiều không?
├─ Cả ba xấu → ghi áp lực dự phòng → Q5
├─ NPL chưa tăng nhưng nợ nhóm 2 tăng hoặc bao phủ giảm → ghi rủi ro sớm → Q5
├─ Cả ba ổn/cải thiện → ghi chất lượng tài sản ổn → Q5
└─ Thiếu/chỉ báo trái chiều → ghi chất lượng chưa đủ rõ → Q5

Q5. Rủi ro ngoại bảng có đáng kể không?
├─ Có, tăng nhanh → ★ "Rủi ro ngoại bảng đáng kể; tổng hợp với áp lực vốn, biên và chất lượng tài sản đã ghi"
├─ Không đáng kể, dữ liệu đầy đủ → ★ "Kết luận tiếp sức/siết từ các trạng thái đã ghi; không kết luận tín dụng thuận nếu hạn mức bị chặn"
└─ Chưa có thuyết minh → ★ "Chưa đủ dữ liệu để kết luận toàn diện; nêu các trạng thái xác minh được và phần ngoại bảng còn thiếu"

## Chỉ báo đặc thù ngành

Bảng dòng BCTC ngân hàng + cách đọc từng tỷ lệ ở `references/kpi.md`. Đọc file đó
khi cần đúng tên dòng trong `vs_financial_norms(btype=3)` hoặc ngưỡng diễn giải.

## Định giá theo đặc thù ngành

Ngân hàng định giá bằng **P/B neo ROE**, không bằng P/E: cùng một P/B, ngân hàng
ROE 20% và ROE 13% là hai giá trị hoàn toàn khác nhau. Nhóm theo ROE rồi so P/B
trong nhóm (`valuation_run` cho vùng; `peer_compare` để xếp hạng trong nhóm cùng
phân khúc). Neo kỳ vọng bằng `planned_targets` (kế hoạch lãi của năm) và
`analyst_consensus`. Ngân hàng lỗ/lãi đột biến một lần → P/E vô nghĩa, ghi rõ
thay vì bịa fair value.

## Rủi ro đặc thù

- **Rủi ro hình thành trễ**: nợ xấu là kết quả đã xảy ra; nợ nhóm 2 + bao phủ là
  chỉ báo trước. Chỉ nhìn nợ xấu sẽ đọc muộn cả chu kỳ.
- **Rủi ro chuẩn mực**: LCR/NSFR theo lộ trình khiến ngân hàng nhỏ phải giữ tài
  sản thanh khoản dư thừa → nới lỏng tín dụng chậm lại hoặc đắt hơn.
- **Rủi ro hạn mức**: dùng hạn mức xong trước Q4 thì quý cuối tăng trưởng sụt.
- **Rủi ro tập trung**: nhóm khách hàng hoặc một ngành cho vay chiếm tỷ trọng lớn
  thì chu kỳ của ngành đó thành chu kỳ của ngân hàng.
- **Rủi ro thành viên yếu**: kỳ vọng tiếp nhận/tái cơ cấu lan sang vốn và dòng
  tiền của cả nhóm — đọc riêng ở bước `news_market`.

## Ranh giới

- Không xác định pha thị trường, không bảo "ngân hàng sắp dẫn sóng", không đọc
  chuỗi luân chuyển → đó là nhiệm vụ của `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán, không đặt tỷ trọng → `phan-tich-chuyen-sau-1-ma`.
- Không suy ngưỡng chuẩn mực từ trí nhớ: mọi trần/tỷ lệ pháp lý phải tra văn bản
  hiện hành rồi ghi nguồn + ngày văn bản (luật này chỉ nằm ở đây, không lặp lại
  trong `references/kpi.md`).
- Chỉ đọc dòng BCTC theo chuẩn ngành (`vs_financial_norms(btype=3)`); đoán tên
  dòng CTCP chung sẽ lấy nhầm chỉ tiêu.

## Giới hạn

- Hạn mức tín dụng là phân bổ hành chính, không công bố đều cho mọi mã: thiếu thì
  hạ độ tin cậy, không suy.
- Nợ nhóm 2 và ngoại bảng không phải kỳ báo cáo nào cũng công bố đầy đủ — ghi rõ
  kỳ còn thiếu thay vì nội suy.
- Chuẩn mực thanh khoản đang trong lộ trình chuyển tiếp: kết luận riêng cho một
  năm có thể không đúng sau khi văn bản mới có hiệu lực.

## Ví dụ

**Ví dụ 1:**
Hỏi: Ngân hàng đang bị siết bởi cái gì?
Đạt khi: có hạn mức tín dụng + nguồn, spread nén/giãn với 2 số QoQ/YoY, 3 lớp
chất lượng tài sản đọc cùng lúc, và verdict đi theo cây Q1→Q5 kèm nhánh dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
stacked thu nhập lãi thuần/ngoài lãi theo quý, multiline NIM+CASA của nhóm cùng
phân khúc, bar nợ xấu/nhóm 2/bao phủ. Vẽ bằng `chart_render` với `from_call`
(mã `[ref …]`) từ kết quả `financial_detail`/`peer_compare` đã có; cần chọn loại
hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần đúng dòng BCTC ngân hàng trong `vs_financial_norms(btype=3)`, ngưỡng diễn giải từng tỷ lệ, và bảng KPI theo báo cáo |
