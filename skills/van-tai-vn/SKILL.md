---
name: van-tai-vn
description: "Đọc ngành vận tải – cảng – logistics – hàng không VN: cước, sản lượng qua cảng, tỷ lệ hợp đồng cố định, nhiên liệu. Dùng khi hỏi nhóm vận tải, cảng biển hay hàng không."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, vs_xnk_detail, vs_indicator_data, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành vận tải, nhóm vận tải, cổ phiếu vận tải, vận tải biển, cảng biển, công ty cảng, cước vận chuyển, cước container, tàu chở container, ngành logistics, nhóm cảng biển, ngành hàng không, hãng hàng không, cổ phiếu hàng không]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Vận tải & logistics Việt Nam — framework phân tích

Vận tải là nhiều chu kỳ dưới một nhãn: **cảng** (sản lượng hàng qua cảng, giá dịch vụ
xếp dỡ, công suất bến — biên ổn nhất), **vận tải container** và **tàu hàng rời, tàu
dầu** (cước biến động theo tuần, chịu tỷ lệ hợp đồng cố định), **logistics** (kho bãi,
giao nhận — bám sản lượng xuất nhập khẩu), **hàng không** (lượng khách, giá nhiên liệu
bay, tỷ giá). Sản lượng qua cảng bám **tổng** khối lượng xuất + nhập khẩu, không bám
chênh lệch giữa hai bên.

## Khi nào dùng

- Dùng khi: hỏi nhóm vận tải, cảng, hàng không đang được tiếp sức hay bị siết; cước
  tăng thì ai hưởng; cảng có còn dư địa.
- Khi KHÔNG dùng:
  - Pha thị trường, vận tải có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Vận chuyển dầu khí của tập đoàn dầu khí → `dau-khi-vn`.
  - Thuế quan và xuất khẩu theo nhóm hàng → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Cước vận tải | Cước container, hàng rời, thuê tàu biến động theo tuần; tuyến dài ra (tàu đi vòng) làm cước tăng dù hàng không đổi | Chỉ số cước container, hàng rời, giá thuê tàu: `web_search` (ghi chỉ số + ngày) |
| Tỷ lệ hợp đồng cố định | Tàu cho thuê định hạn dài hoặc hợp đồng giá cố định thì sóng cước vào doanh thu chậm, theo cả hai chiều | Công bố công ty: `news_symbol`, báo cáo thường niên qua `web_search` |
| Sản lượng qua cảng | Bám tổng khối lượng xuất + nhập khẩu và tuyến tàu ghé cảng; bến mới chưa đủ tải thì chi phí cố định chạy trước | Sản lượng thông qua (TEU, tấn): `news_symbol`, `web_search`; kim ngạch: `vs_indicator_data(indicator="XK")`; thị trường xuất khẩu theo nước: `vs_xnk_detail` |
| Giá dịch vụ cảng | Khung giá xếp dỡ container do nhà nước quy định; điều chỉnh khung giá là biến doanh thu của cảng | `web_search` (văn bản, ngày) |
| Nhiên liệu | Nhiên liệu tàu, nhiên liệu bay bám giá dầu; siết biên vận tải và hàng không khi giá vé/cước chưa kịp theo | `yf_commodities(tickers=["BZ=F","HO=F"])` (dầu, dầu đốt tham chiếu) |
| Hàng không | Lượng khách quốc tế/nội địa, số tàu bay khai thác được, giá vé; nợ thuê tàu bay bằng USD nhạy tỷ giá | `web_search` (số khách theo kỳ), `news_symbol`, `vn_forex_ohlcv` khi cần tỷ giá |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo mảng). Xác định **phân khúc đóng góp lợi nhuận lớn
nhất**; cây đi theo phân khúc đó.

**Bước 2 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
chi phí lãi vay) · `financial_detail(symbol, statement=CDKT)` (tài sản cố định, vay),
4–8 quý.

**Bước 3 (song song, tuỳ phân khúc):** `web_search` (chỉ số cước, sản lượng cảng khu
vực, số khách hàng không, khung giá cảng) · `news_symbol(symbol)` (sản lượng, tàu mới,
bến mới) · `vs_indicator_data(indicator="XK")` và `vs_xnk_detail` (kim ngạch và thị
trường xuất khẩu theo nước) · `yf_commodities` (nhiên liệu tham chiếu).

**Bước 4:** `planned_targets` · `analyst_consensus`. So với doanh nghiệp **cùng phân
khúc**; chỉ báo vận hành của peer đọc bằng `financial_detail` từng mã, `peer_compare`
chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định công ty vận tải đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Phân khúc đóng góp lợi nhuận lớn nhất?
├─ Cảng, bến → tiếp Q3
├─ Vận tải container, hàng rời, tàu dầu → tiếp Q2
├─ Hàng không → ★ "Bám lượng khách, giá nhiên liệu bay và tỷ giá: đọc số khách và
│  chi phí nhiên liệu trên doanh thu trước giá vé"
└─ Logistics, giao nhận, kho bãi → tiếp Q4

Q2 (tàu). Hướng cước của phân khúc và tỷ lệ hợp đồng cố định?
├─ Ít hợp đồng cố định, cước đang lên → ★ "Được tiếp sức bởi cước: doanh thu theo
│  giá thị trường gần như ngay"
├─ Ít hợp đồng cố định, cước đang giảm → ★ "Bị siết bởi cước: doanh thu giảm theo
│  thị trường gần như ngay"
├─ Nhiều hợp đồng cố định → ★ "Hợp đồng cố định làm đệm: sóng cước vào doanh thu
│  chậm, khi hợp đồng được gia hạn, theo cả hai chiều"
└─ Thiếu chỉ số cước hoặc tỷ lệ hợp đồng → ★ "Chưa dựng được cước hoặc độ trễ:
   kết luận chỉ dựa biên và doanh thu các quý gần nhất, độ tin cậy thấp"

Q3 (cảng). Công suất bến có đủ tải không?
├─ Bến mới chạy thấp tải → ★ "Biên đang bị công suất kìm: khấu hao và lãi vay chạy
│  trước sản lượng"
└─ Đủ tải, hoặc không có số công suất → tiếp Q4

Q4 (cảng, logistics). Tổng khối lượng hàng xuất + nhập khẩu và sản lượng qua cảng?
├─ Tăng → ★ "Được tiếp sức bởi sản lượng: hàng qua cảng và kho bãi tăng theo xuất
│  nhập khẩu"
├─ Đi ngang hoặc giảm → ★ "Bị siết bởi sản lượng: giá dịch vụ khó bù phần khối
│  lượng hụt"
└─ Không có số sản lượng → ★ "Chưa đọc được sản lượng: kết luận chỉ dựa công suất và
   biên, độ tin cậy thấp"

## Chỉ báo đặc thù ngành

Cách đọc theo phân khúc ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Cảng: **P/E và EV/EBITDA** ổn định hơn (sản lượng đều, giá theo khung). Tàu: **P/B**
so giá trị đội tàu và **EV/EBITDA** — cước ở đỉnh thì P/E thấp nhất, không phải rẻ.
Hàng không: **EV/EBITDA** vì nợ thuê tàu bay lớn. Chỉ so trong cùng phân khúc.

## Rủi ro đặc thù

- Cước đảo chiều trong vài tuần; đội tàu mới đóng xong cùng lúc làm dư cung.
- Bến mới chưa đủ tải; tuyến tàu lớn chuyển cảng.
- Thuế quan, chính sách thương mại làm giảm khối lượng xuất khẩu và đổi tuyến.
- Nhiên liệu tăng khi cước/giá vé chưa theo; tỷ giá với nợ thuê tàu bay bằng USD.

## Ranh giới

- Không xác định pha thị trường, không nói "vận tải sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu cước, khung giá cảng từ trí nhớ: tra, ghi chỉ số/văn bản + ngày (luật này
  chỉ nằm ở đây).
- Chỉ so trong cùng phân khúc.

## Giới hạn

- Kim ngạch xuất nhập khẩu là số toàn quốc, không phải sản lượng của một cảng.
- `vs_xnk_detail` chia theo nước, không theo nhóm hàng.
- Tỷ lệ hợp đồng cố định không công bố đều — ghi rõ khi thiếu.

## Ví dụ

Hỏi: Cước vận chuyển tăng thì cả nhóm vận tải hưởng không?
Đạt khi: tách tác động theo phân khúc, có chỉ số cước kèm ngày, tỷ lệ hợp đồng cố định
(hoặc ghi thiếu), verdict theo cây cho mã/phân khúc đang hỏi.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường doanh thu và biên theo
quý, cột sản lượng qua cảng, cột biên lãi gộp theo phân khúc. Vẽ bằng `chart_render`
với `from_call` (mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình thì nạp
`ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần nhận diện phân khúc, dòng BCTC theo statement và chỉ báo riêng của cảng, tàu, hàng không |
