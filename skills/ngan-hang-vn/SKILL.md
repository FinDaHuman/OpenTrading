---
name: ngan-hang-vn
description: "Phân tích ngành ngân hàng VN theo bộ chỉ báo riêng: hạn mức tín dụng, spread lãi thuần, chất lượng tài sản 3 lớp, ngoại bảng và chuẩn mực thanh khoản. Dùng khi hỏi xu hướng nhóm ngân hàng hoặc đọc BCTC ngân hàng."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, financial_statements, stock_overview, planned_targets, sbv_rates, analyst_consensus, peer_compare, compare_equities, news_symbol, news_market, dividends_splits, symbol_lookup, vn_company]
triggers:
  keywords: [ngân hàng, nhóm ngân hàng, nợ xấu, lãi suất cho vay, biên lợi nhuận thuần, room tín dụng, tăng trưởng tín dụng, huy động vốn, trần ldr, thanh khoản ngân hàng, cổ phiếu bank, nhóm bank]
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
| Hạn mức tín dụng | SBV cấp hạn mức tăng trưởng tín dụng theo ngân hàng; ngân hàng nhận nhiệm vụ tái cơ cấu ngân hàng yếu thường được hạn mức cao hơn. Hạn mức bị chặn theo quý đầu năm → tăng trưởng sụt theo mùa ở Q1 rồi đuổi về cuối năm | Tăng trưởng tín dụng YTD của mã so hạn mức được công bố: `financial_detail` (theo dòng BCTC ngân hàng) + phân phối hạn mức trong `news_market`/`web_search`. Ghi rõ hạn mức đọc từ đâu |
| Spread lãi thuần | Thu nhập lãi thuần = tài sản sinh lãi × (tỷ suất sinh lời − chi phí vốn). Khi chi phí huy động (giấy tỉ có giá, tiền gửi kỳ hạn) lên nhanh hơn tỷ suất cho vay → spread nén; ngân hàng giữ được nhóm khách hàng ít nhạy giá và cơ cấu vốn rẻ thì nén ít hơn | `financial_detail`: chi phí thu nhập lãi thuần theo quý + cơ cấu huy động; `sbv_rates` cho trần lãi huy động điều hành |
| CASA | Cơ cấu vốn không kỳ hạn là đệm chi phí vốn: nhóm khách hàng bán lẻ càng lớn, spread càng giữ được | Cơ cấu nguồn vốn trong `financial_detail` (chuẩn mực ngân hàng); so với nhóm cùng phân khúc bằng `peer_compare` |
| Chất lượng tài sản 3 lớp | Nợ xấu chỉ là lớp trên cùng. Nợ nhóm 2 (cần chú ý) tăng trong khi nợ xấu phẳng = rủi ro đang hình thành nhưng chưa lên báo cáo; tỷ lệ bao phủ rủi ro giảm = đệm provision đang mỏng. Đọc **3 lớp cùng lúc** mới có kết luận | `financial_detail`: tỷ lệ nợ xấu, tỷ lệ nợ nhóm 2, tỷ lệ bao phủ nợ vay, chi phí rủi ro tín dụng — mỗi quý, kèm xu hướng QoQ |
| Ngoại bảng | Tín dụng tương đương ngoại bảng (bảo lãnh, cam kết) không nằm trong nợ xấu và dự phòng đã công bố → rủi ro thật lớn hơn bảng | `financial_detail` dòng ngoại bảng nếu kỳ báo cáo có; số tổng hợp ngành lấy từ `news_market`/`web_search`, ghi rõ nguồn và kỳ |
| Thanh khoản + chuẩn mực | Khoảng cách tăng trưởng tín dụng − tiền gửi quyết định áp lực huy động; chuẩn mực mới (Circular 50/2026 thay Circular 22, hiệu lực từ 12/2026: trần LDR nới lên, mẫu số tính theo nguồn vốn ổn định hơn, LCR/NSFR theo lộ trình 2027–2028, miễn LDR nếu tuân thủ LCR+NSFR sớm ở mức 100%) quyết định ai bị siết tăng trưởng | `financial_detail` (tín dụng/tiền gửi, trích lãi) + nội dung văn bản qua `news_market`/`web_search`. **Không suy ngưỡng mới** — tra văn bản hiện hành rồi ghi nguồn |

## Các bước

Khoảng 4 lượt gọi tool. Bắt buộc có `vs_financial_norms(btype=3)` TRƯỚC khi đọc dòng
BCTC ngân hàng — dùng dòng chuẩn ngành thay vì đoán tên dòng CTCP chung.

**Bước 1: Chuẩn mực + một mã làm gốc (song song).**

`vs_financial_norms(btype=3)` (dòng BCTC ngân hàng) · `symbol_lookup` (nếu user
đưa tên công ty) · `vn_company` (hồ sơ, mô hình). Thiếu hạn mức tín dụng công bố
→ ghi "không lấy được hạn mức", không đoán.

**Bước 2: Đọc 3 lớp chất lượng tài sản + spread (song song).**

`financial_detail` cho từng mã (1 lượt, gom song song): nợ xấu · nợ nhóm 2 · tỷ lệ
bao phủ · chi phí rủi ro · chi phí thu nhập lãi thuần. So QoQ/YoY, ghi số + kỳ.

**Bước 3: Bối cảnh vốn + chuẩn mực (song song).**

`sbv_rates` (chế độ lãi suất điều hành) · `news_market` (phân phối hạn mức tín
dụng, văn bản chuẩn mực mới, điều chỉnh room). Ghi rõ số nào từ tool nào.

**Bước 4: Neo kỳ vọng + vị thế trong nhóm.**

`planned_targets` (kế hoạch năm của mã) · `peer_compare` (so NIM/CASA/NPL với
nhóm cùng phân khúc) · `analyst_consensus` (neo quan điểm CTCK — làm kỳ vọng,
không thay thế kết luận).

## Cây quyết định ngành đang tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu ở
một nhánh thì hạ độ tin cậy, không bù số.

Q1. Hạn mức tín dụng năm nay có được công bố rõ và còn headroom không?
├─ CÓ, headroom rộng → tiếp tục Q2
└─ KHÔNG hoặc đã dùng gần hết → ★ "Tăng trưởng bị chặn bởi hạn mức — driver lợi
   nhuận của năm nay là spread và phí, không phải tín dụng". Đọc Q2 để chốt chất
   lượng, dừng.

Q2. Spread lãi thuần đang giãn hay nén?
├─ Nén (chi phí vốn tăng nhanh hơn tỷ suất sinh lời) → Q3 để xem nén do đâu
└─ Giãn/đi ngang → Q4

Q3. Nguyên nhân nén là chi phí vốn hay cơ cấu tài sản?
├─ Chi phí vốn (huy động đắt, CASA giảm) → ★ "Bị siết bởi vốn: ưu tiên mã có
   nhóm khách hàng rẻ + khả năng giữ giá cho vay"
└─ Cơ cấu tài sản (tỷ suất sinh lợi giảm do trộn lẫn) → ★ "Bị siết bởi chất lượng
   tài sản: đọc Q4 trước khi dùng mảng này làm kênh tăng trưởng"

Q4. Chất lượng tài sản 3 lớp có cùng chiều không?
├─ Nợ xấu phẳng nhưng nợ nhóm 2 tăng HOẶC tỷ lệ bao phủ giảm → ★ "Chất lượng đang
   xấu đi chậm: rủi ro hình thành trước báo cáo"
├─ Cả 3 lớp cùng xấu → ★ "Bị siết: chi phí dự phòng sẽ nuốt tăng trưởng"
└─ Cả 3 lớp ổn hoặc cải thiện → Q5

Q5. Kênh ngoại bảng có đáng kể không?
├─ Có, tăng nhanh so với tín dụng trên bảng → ★ "Rủi ro ngoại bảng treo trên
   định giá: đọc cả ngoại bảng khi so với nhóm"
└─ Không đáng kể → ★ "Ngành được tiếp sức bởi tín dụng trừ khi hạn mức chặn (Q1)"

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
