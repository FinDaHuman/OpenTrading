---
name: hoa-chat-vn
description: "Phân tích ngành hoá chất và phân bón Việt Nam theo chu kỳ giá ure, chính sách xuất khẩu Trung Quốc, tỷ lệ xuất khẩu và chi phí khí đầu vào. Dùng khi hỏi xu hướng nhóm hoá chất hoặc công ty phân bón."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, vs_xnk_detail, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành hoá chất, phân bón, sản xuất phân bón, giá phân bón, nhà máy hoá chất, khí đầu vào phân bón, chu kỳ giá phân bón]
version: 1.0.0
---

# Hoá chất & phân bón Việt Nam — framework phân tích

Ngành này sinh lời theo **cửa sổ giá**: lợi nhuận đến từ giai đoạn giá bán vượt
chi phí đầu vào, và cửa sổ đó có thể mở rồi đóng trong một quý. Skill này đọc ngành
bằng chu kỳ giá phân bón, **chính sách xuất khẩu của Trung Quốc** (biến số cung toàn
cầu), tỷ lệ xuất khẩu (quyết định công ty bám giá nội địa hay bám giá quốc tế), và
chi phí khí đầu vào.

Một điểm dễ đọc sai: **tồn kho giá gốc thấp**. Khi giá thị trường nhảy, lãi gộp còn
được hỗ trợ 1–2 quý bởi tồn kho mua trước khi giá lên, rồi đảo chiều. Biên một quý
tốt chưa nói lên năng lực.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm hoá chất/phân bón, tại sao lãi nhảy rồi sụt,
  công ty phân bón chịu gì từ giá quốc tế và Trung Quốc.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Xuất khẩu nông sản (gạo, cà phê, hạt điều) → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Chu kỳ giá phân bón | Giá bán là biến số số 1: giá nhảy theo cú sốc cung (địa chính trị, thời tiết, xuất khẩu) rồi thu về. Ngành ăn theo **cửa sổ giá**, không theo xu hướng dài | Giá phân bón quốc tế và nội địa: `news_market`/`web_search`, ghi rõ chỉ số giá + ngày |
| Chính sách xuất khẩu Trung Quốc | Trung Quốc là nguồn cung lớn; kiểm soát xuất khẩu (hạn ngạch, cấm, thuế) làm giá toàn cầu nhảy và ngược lại | Chính sách xuất khẩu: `news_market`/`web_search`, ghi rõ văn bản/thông báo + ngày |
| Tỷ lệ xuất khẩu | Công ty xuất phần lớn sản lượng thì bám giá quốc tế và giao dịch ngoại thương; công ty bán nội địa thì lãi bị khung giá trong nước và nhu cầu nội địa quyết định | Tỷ lệ xuất khẩu: công bố công ty trong `news_market`; xuất khẩu ngành: `vs_xnk_detail` |
| Chi phí khí đầu vào | Chi phí khí đầu vào theo hợp đồng dài hạn là chi phí cố định lớn; nhiên liệu tham chiếu đỡ phần dự báo | Chi phí nhiên liệu tham chiếu: `yf_commodities` theo chu kỳ; chi phí giá vốn trong `financial_detail` |
| Nhu cầu nội địa | Nhu cầu nội địa nhạy giá nông sản (như lúa); yếu khi giá nông sản thấp hoặc giá phân bón cao | Nhu cầu nội địa: `news_market`, `vs_indicator_data` (sản xuất nông nghiệp) |
| Tồn kho giá gốc | Tồn kho mua trước khi giá lên hỗ trợ biên 1–2 quý rồi đảo chiều — nhãn "cửa sổ" của toàn ngành | Tồn kho trong `financial_detail`; tỷ lệ xuất trong công bố công ty |

## Các bước

**Bước 1: Nhận diện cơ cấu mảng (song song).**

`symbol_lookup` · `vn_company` (mảng: phân bón / hoá chất / thương mại) ·
`financial_detail` (doanh thu theo mảng). Ghi rõ tỷ lệ xuất khẩu nếu công bố.

**Bước 2: Hai đầu giá (song song).**

`news_market` (giá phân bón quốc tế + nội địa, chính sách Trung Quốc, tình trạng
cung) · `yf_commodities` (năng lượng tham chiếu cho chi phí đầu vào) ·
`vs_xnk_detail` (xuất khẩu phân bón theo kỳ).

**Bước 3: Biên + tồn kho (song song).**

`financial_detail`: doanh thu, giá vốn → biên lãi gộp theo quý; tồn kho; chi phí
tài chính. Đọc 4 quý liền để phân biệt "cửa sổ giá" với năng lực bền.

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `peer_compare` (so biên lãi gộp, tỷ lệ xuất khẩu, chi phí đầu
vào trong nhóm) · `analyst_consensus`.

## Cây quyết định công ty hoá chất đang được tiếp sức hay siết

Duyệt Q1→Q5 theo thứ tự, **DỪNG ở ★ đầu tiên** mà ĐỦ điều kiện. Thiếu dữ liệu thì
hạ độ tin cậy, không bù số.

Q1. Tỷ lệ xuất khẩu của công ty?
├─ Xuất phần lớn sản lượng → tiếp Q2 (nhánh quốc tế)
├─ Bán chủ yếu nội địa → tiếp Q4 (nhánh nội địa)
└─ Không rõ → tiếp Q2 với độ tin cậy thấp, ghi rõ

Q2 (quốc tế). Cửa sổ giá quốc tế đang mở hay đóng?
├─ Mở (giá nhảy sau cú sốc cung) → tiếp Q3
├─ Đóng (giá hạ về sau cú sốc) → ★ "Bị siết bởi giá: doanh thu sẽ bám giá thị
   trường, biên co về — đọc tồn kho giá cao còn lại"
└─ Chưa dựng được giá → Q3 với độ tin cậy thấp

Q3 (quốc tế). Chính sách Trung Quốc đang nới hay siết?
├─ Siết (kiểm soát xuất khẩu) → ★ "Cung toàn cầu bị nuôi: cửa sổ giá có thể nở rộng
   thêm — nhưng ghi rõ đây là cơ hội theo chính sách, không phải kỳ vọng dài hạn"
└─ Nới (xuất khẩu tăng trở lại) → ★ "Cung toàn cầu quay lại: cửa sổ đang đóng,
   đọc tỷ lệ khóa đơn hàng trước khi kỳ vọng biên"

Q4 (nội địa). Nhu cầu nội địa và giá bán có cùng chiều không?
├─ Có, nhu cầu hồi + giá giữ được → tiếp Q5
└─ Không, giá quốc tế lên nhưng nhu cầu nội địa yếu → ★ "Bị siết bởi cầu: khung giá
   trong nước giới hạn phần được tăng giá trong cửa sổ này"

Q5 (chung). Chi phí đầu vào và biên có cùng chiều với giá bán không?
├─ Có, giá bán tăng nhanh hơn chi phí đầu vào → ★ "Được tiếp sức: xác nhận biên
   mở rộng trên 2 quý liền trước khi nội suy"
└─ Không, chi phí đầu vào đuổi kịp giá bán → ★ "Bị siết bởi chi phí: cửa sổ giá
   không còn đủ rộng, đọc tồn kho giá gốc để xem biên còn được hỗ trợ bao lâu"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành hoá chất/phân bón + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Hoá chất/phân bón là chu kỳ giá: định giá bằng **EV/EBITDA theo vòng** và **P/B so
đáy của chính ngành**, không dùng P/E tại đỉnh cửa sổ giá. Đánh dấu rõ một kỳ lãi
bất thường là "cửa sổ giá" và không nội suy. Neo kỳ vọng bằng `planned_targets` và
`analyst_consensus`.

## Rủi ro đặc thù

- **Rủi ro cửa sổ đóng**: giá hồi sau cú sốc cung và biên co về trong 1–2 quý.
- **Rủi ro chính sách Trung Quốc đảo chiều**: nới xuất khẩu làm giá toàn cầu giảm,
  tác động đến cả công ty bán nội địa qua khung giá.
- **Rủi ro tồn kho giá cao**: mua đầu vào trước khi giá lên rồi giá giảm → biên bị
  nén hai chiều.
- **Rủi ro cầu nội địa**: nhu cầu nhạy giá nông sản; nông sản yếu thì phân bón yếu
  theo.
- **Rủi ro khung giá trong nước**: công ty bán nội địa không hưởng trọn cửa sổ
  quốc tế.

## Ranh giới

- Không xác định pha thị trường, không suy "hoá chất sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy chính sách xuất khẩu Trung Quốc từ trí nhớ: tra thông báo/văn bản hiện
  hành, ghi nguồn và ngày.
- Không dùng giá quốc tế thay giá bán thực tế của công ty — giá bán trong công bố
  công ty mới là giá áp dụng.

## Giới hạn

- Giá năng lượng từ `yf_commodities` là tham chiếu, không phải giá khí hợp đồng dài
  hạn của từng nhà máy.
- Tỷ lệ xuất khẩu là công bố không định kỳ: khi thiếu, hạ độ tin cậy nhánh Q1.
- Chu kỳ giá ngắn: mọi kết luận phải ghi ngày tra giá.

## Ví dụ

**Ví dụ 1:**
Hỏi: Giá ure tăng mạnh thì công ty phân bón hưởng không?
Đạt khi: có giá quốc tế + ngày tra, chính sách Trung Quốc, tỷ lệ xuất khẩu, biên 2
quý liền, và verdict theo cây Q1→Q5.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
multiline giá phân bón với biên lãi gộp, bar biên theo nhóm, waterfall giá bán
trừ chi phí đầu vào. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết
quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc cửa sổ giá, phân biệt nội địa – quốc tế, và cách đọc tồn kho giá gốc |
