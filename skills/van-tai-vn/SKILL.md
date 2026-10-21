---
name: van-tai-vn
description: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành vận tải và logistics Việt Nam theo cước vận chuyển, cầu xuất khẩu, công suất cảng và chi phí nhiên liệu. Dùng khi hỏi xu hướng nhóm vận tải, công ty cảng hay cước vận chuyển."
activation: auto
requires_tools: [financial_detail, vs_xnk_detail]
uses_tools: [financial_detail, vs_xnk_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, yf_commodities, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành vận tải, vận tải biển, cảng biển, cước vận chuyển, tàu chở container, luồng hàng hoá, công ty cảng, mảng logistics]
version: 1.0.0
---

# Vận tải & logistics Việt Nam — framework phân tích

Ngành vận tải VN là **chu kỳ cước, không phải chu kỳ nhu cầu nội địa**: dòng thu
bám cước vận chuyển quốc tế và thể tích hàng qua cảng. Skill này đọc ngành qua cước
tuyến, cầu xuất khẩu (tín hiệu dẫn của lưu lượng), công suất cảng (nơi chứa biên
lợi nhuận bền vững nhất), và **tỷ lệ hợp đồng cố định** — thứ quyết định ai thực
sự hưởng sóng cước và ai bị khóa giá bỏ lỡ.

Yếu tố thứ hai: **phân khúc**. Cảng nước sâu, vận tải container nội Á, và vận tải
dầu nằm trong ba chu kỳ khác nhau — cước tàu dầu đắt kỷ lục có thể đi kèm với vận
tải container bị siết.

## Khi nào dùng

- Dùng khi: user hỏi xu hướng nhóm vận tải, cước vận chuyển tác động ra sao, một
  công ty cảng có còn dư địa, thuế quan ảnh hưởng ai.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi pha thị trường / luân chuyển ngành / sóng ngành tiếp theo → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.
  - Chỉ định giá một mã → `dinh-gia-chuyen-sau`.
  - Chỉ đọc BCTC một mã không có mảng ngành → `co-ban-chuyen-sau`.
  - Vận tải thuộc tập đoàn dầu khí (mảng vận chuyển) → đọc tiếp ở `dau-khi-vn`.

## Trụ cột driver

| Driver | Kênh truyền dẫn | Đọc/xác minh bằng |
|---|---|---|
| Cước vận chuyển | Bảng cước theo tuyến (xuyên Đại Dương, nội Á, Âu-Mỹ) quyết định doanh thu mảng vận tải. Cước lên không đồng đều: tuyến ngắn và bến trung chuyển chịu quy luật khác | Cước tuyến: `news_market`/`web_search`, ghi rõ chỉ số cước + ngày; riêng mã giá thu bình quân trong `financial_detail` |
| Cầu xuất khẩu | Lưu lượng hàng qua cảng bám xuất khẩu và nhập khẩu linh kiện. Đọc sản lượng TEU/tấn qua cảng và tổng lưu lượng thương mại; giá trị nhập thiết bị tăng không chứng minh nhu cầu vận tải tăng | Xuất/nhập khẩu theo kỳ: `vs_xnk_detail`; cầu ngành tổng hợp: `news_market` |
| Công suất cảng | Bến mới chạy chưa đủ tải làm chi phí cố định đội lên; công suất đủ thì giá thu được giữ. Đây là nguồn biên bền vững nhất ngành | Tỷ lệ sử dụng bến + cước dịch vụ: `news_market`/`web_search`; riêng mã doanh thu/cước bình quân trong `financial_detail` |
| Tỷ lệ khóa giá | Hợp đồng vận chuyển theo định kỳ dài hạn co giãn thu nhập: tỷ lệ khóa cao thì sóng cước không vào doanh thu ngay | Tỷ trọng hợp đồng cố định: `news_market`/`web_search`; dấu hiệu gián tiếp ở doanh thu/khối lượng trong `financial_detail` |
| Nhiên liệu | Chi phí nhiên liệu và chi phí bến siết biên vận tải; ngược lại ít ảnh hưởng cảng | Giá nhiên liệu: `yf_commodities` theo chu kỳ |
| Chính sách thương mại | Thuế quan đổi hướng tuyến: tuyến nội Á chịu ít hơn tuyến đi Mỹ | Thuế/chính sách: `news_market`/`web_search` |

## Các bước

**Bước 1: Nhận diện phân khúc (song song).**

`symbol_lookup` · `vn_company` (mảng: cảng / container nội Á / tàu dầu / giao nhận
chuyển phát) · `financial_detail` (doanh thu theo mảng). Ghi rõ phân khúc.

**Bước 2: Cước + cầu (song song).**

`news_market` (cước tuyến, chỉ số cước, cước tàu dầu nếu liên quan) ·
`vs_xnk_detail` (tổng xuất + nhập cùng kỳ làm bối cảnh; tách giá/khối lượng, không suy TEU từ giá trị).

**Bước 3: Công suất + khối lượng + chi phí (song song).**

`news_market` (tỷ lệ sử dụng bến, lưu lượng qua cảng, tuyến mới) ·
`financial_detail` (doanh thu, giá vốn, chi phí tài chính, tồn kho nhiên liệu) ·
`yf_commodities` (nhiên liệu tham chiếu nếu đường biển).

**Bước 4: Neo kỳ vọng + vị thế nhóm.**

`planned_targets` · `analyst_consensus` · `peer_compare` (so **trong cùng phân
khúc** — so cảng với vận tải container bị cấm).

Đối chiếu công cụ: `peer_compare` chỉ dùng các key tổng quan thực sự có trong kết quả (như P/E, P/B, ROE); tham số `metrics` không tạo thêm chỉ tiêu. Biên, sản lượng, chi phí, tồn kho và KPI vận hành phải đọc `financial_detail` từng peer cùng kỳ; nếu không có thì tra công bố doanh nghiệp qua `news_symbol`/`web_search`, ghi nguồn, công thức và kỳ. Thiếu dữ liệu thì để trống, không xếp hạng.

## Cây quyết định công ty vận tải đang được tiếp sức hay siết


Đi theo nhánh phù hợp; ghi nhận trạng thái trung gian và chỉ dừng ở ★. Mọi kết luận phải tách dữ liệu đã biết và phần còn thiếu, không bù số hay đổi "chưa rõ" thành "xấu".

Q1. Công ty thuộc phân khúc nào?
├─ Cảng/bến → Q4 (cảng)
├─ Container → Q2 (container)
├─ Tàu dầu/hàng rời → ★ "Đánh giá cước tuyến, tonne-mile, sản lượng và hợp đồng; thiếu thì chưa đủ dữ liệu cho phân khúc"
├─ Giao nhận/chuyển phát → ★ "Đánh giá lưu lượng bưu kiện, giá dịch vụ và chi phí; thiếu thì chưa đủ dữ liệu cho phân khúc"
├─ Nhiều phân khúc → đánh giá độc lập từng phân khúc theo Q1 rồi tổng hợp theo tỷ trọng công bố
└─ Chưa rõ → ★ "Chưa đủ dữ liệu phân khúc"

Q2 (container). Cước và tỷ lệ khóa giá ra sao?
├─ Cước lên, hợp đồng cho phép hưởng giá mới → ghi thuận lợi, tiếp Q3
├─ Cước giảm hoặc khóa giá làm chậm hưởng lợi → ghi áp lực/độ trễ, tiếp Q3
└─ Chưa rõ cước/hợp đồng → ghi thiếu, tiếp Q3

Q3 (container). Chính sách thương mại ảnh hưởng tuyến thực tế thế nào?
├─ Tuyến và lưu lượng giữ được, đã xác minh thuế theo hàng/xuất xứ/đích/ngày → tiếp Q5
├─ Có bằng chứng mất hàng hoặc chuyển tuyến gây chi phí → ghi áp lực chính sách, tiếp Q5
└─ Chưa rõ chính sách/tuyến → ghi thiếu, tiếp Q5

Q4 (cảng). Công suất và lưu lượng bến ra sao?
├─ TEU/tấn và tỷ lệ sử dụng tăng → ghi thuận lợi, tiếp Q5
├─ Bến mới chưa đủ tải hoặc sản lượng giảm → ghi áp lực chi phí cố định, tiếp Q5
└─ Chưa có số liệu → ghi thiếu, tiếp Q5

Q5 (chung). Cầu nền và biên có xác nhận không?
├─ TEU/tấn tăng cùng kỳ, biên giữ được, cước/công suất thuận lợi → ★ "Được tiếp sức bởi lưu lượng và vận hành đã xác minh"
├─ TEU/tấn giảm hoặc doanh thu chỉ tăng nhờ giá/cước → ★ "Có áp lực cầu hoặc phụ thuộc giá; nêu bằng chứng và độ nhạy cước"
└─ Chỉ có giá trị thương mại hoặc dữ liệu thiếu/trái chiều → ★ "Chưa đủ dữ liệu cầu thực; không suy cầu từ nhập máy móc tăng nhanh hơn xuất khẩu"

## Chỉ báo đặc thù ngành

Bảng chỉ báo ngành vận tải + cách đọc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Vận tải định giá **theo phân khúc**: cảng/cảng biển theo P/E ổn định hơn (doanh
thu theo hợp đồng dài hạn), vận tải container theo EV/EBITDA chu kỳ (không P/E tại
đỉnh cước). Neo kỳ vọng bằng `planned_targets` và `analyst_consensus`. Cước đang
ở đỉnh chu kỳ thì mọi multiple đều rẻ — ghi rõ vị thế trong vòng trước khi so.

## Rủi ro đặc thù

- **Rủi ro cước đảo chiều**: cước vận chuyển biến động trong vài tuần, không phải
  vài quý.
- **Rủi ro công suất bến**: bến mới chưa đủ tải, chi phí cố định chạy trước doanh
  thu.
- **Rủi ro chính sách thương mại**: thuế quan đổi hướng tuyến và lưu lượng, tác
  động chênh lệch giữa các công ty.
- **Rủi ro nhiên liệu**: siết biên vận tải ngay khi cước chưa kịp điều chỉnh.
- **Rủi ro hỗn hợp phân khúc**: công ty vừa cảng vừa tàu sẽ cho con số hợp nhất
  lệch khỏi cả hai chu kỳ.

## Ranh giới

- Không xác định pha thị trường, không suy "vận tải sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không chọn mã khuyến nghị mua/bán → `phan-tich-chuyen-sau-1-ma`.
- Không suy cước tuyến từ một kỳ báo cáo: cước là chu kỳ ngắn, phải tra cước theo
  thời gian gần và ghi ngày nguồn.
- Chỉ xếp hạng trong cùng phân khúc; so cảng với container bị cấm.

## Giới hạn

- Cước tuyến là chu kỳ ngắn và biến động mạnh: kết luận phải ghi ngày tra, không
  dùng số tuần trước.
- Xuất/nhập khẩu từ `vs_xnk_detail` là tín hiệu cầu chung, không phải lưu lượng
  của riêng công ty.
- Tỷ lệ hợp đồng cố định không công bố đều: khi thiếu, hạ độ tin cậy nhánh Q2.

## Ví dụ

**Ví dụ 1:**
Hỏi: Cước vận chuyển lên thì cả nhóm vận tải hưởng không?
Đạt khi: tách được phân khúc, có cước tuyến + ngày tra, tỷ lệ khóa giá, và verdict
theo cây Q1→Q5 cho từng phân khúc.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Hợp với dữ liệu skill này:
multiline cước tuyến với giá thu bình quân, bar biên lãi gộp theo phân khúc, bar
lưu lượng qua cảng. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]`) từ kết
quả tool đã có; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách phân khúc, đọc giá thu bình quân và biên theo phân khúc, dùng cước tuyến và cầu xuất khẩu |
