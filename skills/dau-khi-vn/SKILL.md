---
name: dau-khi-vn
description: "Đọc ngành dầu khí VN theo từng mảng: khai thác, dịch vụ kỹ thuật, vận chuyển, lọc hoá dầu, phân phối khí và xăng dầu. Dùng khi hỏi nhóm dầu khí chịu gì từ giá dầu."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, financial_statements, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành dầu khí, nhóm dầu khí, cổ phiếu dầu khí, công ty dầu khí, dịch vụ dầu khí, lọc hoá dầu, phân phối khí, giàn khoan, dự án khai thác dầu]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Dầu khí Việt Nam — framework phân tích

"Dầu khí" là một nhãn chung cho nhiều mảng có chu kỳ khác nhau: **khai thác** (bám
giá dầu và sản lượng), **dịch vụ kỹ thuật** (khoan, xây lắp — bám chi tiêu đầu tư của
chủ mỏ, đi sau giá dầu), **vận chuyển** (cước tàu, độ dài tuyến), **lọc hoá dầu**
(chênh lệch giá sản phẩm và dầu thô), **phân phối khí và bán lẻ xăng dầu** (sản lượng
tiêu thụ, giá điều hành, chênh lệch tồn kho). Đọc sai mảng là kết luận ngược: giá dầu
giảm có thể tốt cho mảng này và xấu cho mảng kia.

## Khi nào dùng

- Dùng khi: hỏi nhóm dầu khí đang được tiếp sức hay bị siết, một công ty dầu khí chịu
  gì từ giá dầu, khai thác và lọc dầu khác nhau thế nào.
- Khi KHÔNG dùng:
  - Pha thị trường, dầu khí có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Chỉ hỏi giá dầu hôm nay → `yf_commodities`, không cần skill.
  - Cung cầu dầu thế giới, OPEC+, vĩ mô quốc tế → `danh-gia-vi-mo-quoc-te`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Giá dầu | Khai thác hưởng trực tiếp; dịch vụ kỹ thuật hưởng sau khi chủ mỏ tăng ngân sách; lọc dầu và phân phối chịu chênh lệch tồn kho khi giá biến động mạnh | `yf_commodities(tickers=["BZ=F","CL=F"], period="6mo")` (Brent, WTI tham chiếu) |
| Chi tiêu đầu tư thượng nguồn | Dự án mỏ mới được phê duyệt và triển khai là đơn hàng của dịch vụ khoan, xây lắp; giá thuê giàn khoan đi theo | `web_search` (dự án, giá thuê giàn), `company_events` + `news_symbol` của mã |
| Sản lượng và trữ lượng | Sản lượng hiện tại chỉ bền khi trữ lượng được bù; mỏ cũ suy giảm tự nhiên | `web_search` (công bố tập đoàn/ngành), `news_symbol` |
| Chênh lệch lọc dầu | Giá sản phẩm (xăng, dầu diesel…) trừ giá dầu thô đầu vào; tồn kho dầu thô làm lãi/lỗ đột biến khi giá đổi chiều | `web_search` (chênh lệch tham chiếu khu vực), biên lãi gộp `financial_detail(statement=KQKD)` |
| Phân phối khí, xăng dầu | Sản lượng tiêu thụ, giá bán điều hành theo kỳ, chênh lệch tồn kho; khí bán cho điện và đạm theo hợp đồng | Doanh thu, sản lượng: `financial_detail`, `news_symbol`; cơ chế giá điều hành: `web_search` |
| Vận chuyển | Cước tàu dầu, khí tăng khi tuyến dài ra (tàu phải đi vòng) dù khối lượng không đổi; hợp đồng thuê dài hạn làm chậm tác động | `web_search` (cước, tình trạng tuyến, ghi ngày) |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo mảng). Xác định **mảng đóng góp lợi nhuận lớn nhất**;
cây đi theo mảng đó, mảng khác nêu ở phần rủi ro.

**Bước 2 (song song):** `yf_commodities` (Brent/WTI 6 tháng) ·
`financial_detail(symbol, statement=KQKD)` 4–8 quý (doanh thu, giá vốn, biên).

**Bước 3 (song song):** `web_search` (dự án thượng nguồn, giá thuê giàn khoan, chênh
lệch lọc dầu, cước tàu — tuỳ mảng, ghi nguồn + ngày) · `company_events(symbol)` +
`news_symbol(symbol)` (hợp đồng mới, dự án của riêng mã).

**Bước 4:** `planned_targets` (kế hoạch thường đặt theo một mức giá dầu giả định — so
với giá hiện tại) · `analyst_consensus`. So với doanh nghiệp **cùng mảng**; chỉ báo vận
hành của peer đọc bằng `financial_detail` từng mã, `peer_compare` chỉ trả P/E, P/B,
EPS, BVPS, ROE/ROA.

## Cây quyết định công ty dầu khí đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Mảng đóng góp lợi nhuận lớn nhất?
├─ Khai thác → tiếp Q2
├─ Dịch vụ kỹ thuật (khoan, xây lắp, giàn) → tiếp Q3
├─ Lọc hoá dầu → ★ "Bám chênh lệch lọc dầu và chênh lệch tồn kho, không bám mức giá
│  dầu: đọc biên lãi gộp và giá dầu biến động mạnh trong quý"
├─ Vận chuyển dầu khí → ★ "Bám cước tàu và tỷ lệ hợp đồng dài hạn: giá dầu chỉ tác
│  động gián tiếp"
└─ Phân phối khí, bán lẻ xăng dầu → ★ "Bám sản lượng tiêu thụ, giá điều hành và
   chênh lệch tồn kho: giá dầu tăng nhanh có thể làm lãi tồn kho một lần"

Q2 (khai thác). Giá dầu so với mức kế hoạch hoặc giá hoà vốn?
├─ Thấp hơn và đang giảm → ★ "Khai thác bị siết bởi giá dầu: đọc chi phí khai thác
│  để xem chịu được bao lâu"
├─ Cao hơn hoặc đang tăng → tiếp Q4
└─ Không có mức so sánh → tiếp Q4, ghi rõ

Q3 (dịch vụ). Chủ mỏ có đang tăng chi tiêu đầu tư không?
├─ Có dự án lớn được phê duyệt/triển khai, giá thuê giàn tăng → tiếp Q5
├─ Dự án lùi, giá thuê giàn giảm → ★ "Dịch vụ bị siết bởi đơn hàng: doanh thu đi sau
│  quyết định đầu tư của chủ mỏ"
└─ Chưa rõ → tiếp Q5

Q4 (khai thác). Trữ lượng có được bù không?
├─ Không, sản lượng giảm và chưa có mỏ mới → ★ "Bị siết bởi trữ lượng: lãi hiện tại
│  đang dựa mỏ cũ"
└─ Có mỏ mới hoặc không có số → tiếp Q5

Q5 (chung). Doanh thu có phụ thuộc một dự án/hợp đồng không?
├─ Có → ★ "Rủi ro tập trung: một dự án đổi tiến độ là cả năm đổi chiều"
└─ Không → ★ "Được tiếp sức: mảng chính thuận chiều và nguồn thu đủ rộng"

## Chỉ báo đặc thù ngành

Cách đọc theo mảng ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Khai thác và dịch vụ: **EV/EBITDA** và **P/B** so với vùng của chính doanh nghiệp
qua chu kỳ giá dầu; P/E thấp nhất thường đúng lúc lãi đỉnh. Phân phối: **P/E** và cổ
tức (dòng tiền đều hơn). Lọc dầu: EV/EBITDA, loại lãi/lỗ tồn kho trước khi tính.
Kế hoạch năm đặt theo giá dầu giả định — so giả định đó với giá hiện tại.

## Rủi ro đặc thù

- Giá dầu đảo chiều trong vài tháng; lọc dầu và phân phối chịu lỗ tồn kho khi giá
  giảm nhanh.
- Dự án thượng nguồn lùi tiến độ làm hụt đơn hàng dịch vụ cả năm.
- Mỏ suy giảm tự nhiên; chuyển dịch năng lượng làm khó tài trợ dự án mới.
- Doanh nghiệp nhiều mảng: mảng phụ có thể đi ngược mảng chính.

## Ranh giới

- Không xác định pha thị trường, không xếp dầu khí vào chuỗi luân chuyển ngành →
  `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không dự báo giá dầu; chỉ dùng giá tra được và kỳ vọng có nguồn, ghi ngày.
- Chỉ so trong cùng mảng.

## Giới hạn

- Giá từ `yf_commodities` là giá hợp đồng tương lai tham chiếu, không phải giá bán
  thực của công ty.
- Sản lượng, trữ lượng, cước tàu là công bố không định kỳ — ghi kỳ, không nội suy.

## Ví dụ

Hỏi: Giá dầu giảm thì nhóm dầu khí chịu gì?
Đạt khi: tách tác động theo từng mảng, có giá Brent kèm kỳ, nêu mảng chính của mã
đang hỏi (nếu có), verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: đường giá Brent với biên lãi
gộp theo quý, cột doanh thu theo mảng. Vẽ bằng `chart_render` với `from_call` (mã
`[ref …]`) từ kết quả `yf_commodities`/`financial_detail` đã có; cần chọn loại hình thì
nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần nhận diện mảng, chỉ báo và cách đọc riêng của từng mảng |
