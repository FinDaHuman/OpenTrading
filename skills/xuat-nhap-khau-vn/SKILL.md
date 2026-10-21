---
name: xuat-nhap-khau-vn
description: "Đọc xuất nhập khẩu VN theo nhóm hàng: chênh lệch thuế Mỹ so với đối thủ, nhập máy móc làm chỉ báo dẫn, FDI, đơn hàng, tỷ giá. Dùng khi hỏi ngành xuất khẩu chịu gì, nhóm hàng nào hưởng."
activation: auto
requires_tools: [vs_indicator_data]
uses_tools: [vs_indicator_data, vs_categories, vs_xnk_detail, vn_forex_ohlcv, financial_detail, financial_statements, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành xuất nhập khẩu, ngành xuất khẩu, nhóm xuất khẩu, doanh nghiệp xuất khẩu, kim ngạch xuất khẩu, cán cân thương mại, nhập siêu, xuất siêu, thuế đối ứng, xuất khẩu tăng, nhập khẩu máy móc, vốn fdi, đầu tư trực tiếp nước ngoài]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Xuất nhập khẩu Việt Nam — framework phân tích

Tổng kim ngạch là một con số che nhiều nhóm hàng đi ngược nhau. Skill này đọc theo
**nhóm hàng** và bốn biến:

1. **Thuế quan của thị trường nhập khẩu (chủ yếu Mỹ) có hai lớp.** Lớp theo nước: mức
   thuế đối ứng **khác nhau giữa các nước**, nên chênh lệch giữa Việt Nam và đối thủ
   cùng mặt hàng (Trung Quốc, Ấn Độ, Indonesia, Bangladesh, Thái Lan…) đổi thứ hạng cạnh
   tranh. Lớp theo mặt hàng: thuế riêng cho một số ngành áp cho mọi nước, kèm danh sách
   miễn trừ và quy tắc xuất xứ, chống chuyển tải.
2. **Chu kỳ của nhóm hàng**: điện tử, linh kiện theo chu kỳ công nghệ toàn cầu; dệt may,
   giày dép, đồ gỗ theo đơn hàng và tồn kho của nhà bán lẻ nước ngoài; nông thuỷ sản
   theo mùa vụ, giá thế giới và rào kiểm dịch.
3. **Nhập khẩu máy móc, linh kiện là chỉ báo dẫn**: dây chuyền mới nhập trước, vài quý
   sau mới ra hàng xuất khẩu.
4. **FDI**: doanh nghiệp vốn nước ngoài chiếm phần lớn kim ngạch; vốn đăng ký và giải
   ngân mới báo trước công suất xuất khẩu.

## Khi nào dùng

- Dùng khi: hỏi ngành/nhóm hàng xuất khẩu chịu gì từ thuế quan, xuất khẩu tăng thì nhóm
  nào hưởng, nhập khẩu máy móc nói lên gì, FDI vào ngành nào.
- Khi KHÔNG dùng:
  - Pha thị trường, xuất khẩu tốt thì ngành nào dẫn sóng → `dinh-vi-chu-ky-vn`.
  - Số GDP, CPI, xuất khẩu tháng như một chỉ tiêu vĩ mô → `danh-gia-vi-mo-viet-nam`.
  - Khối ngoại mua/bán ròng trên sàn chứng khoán: không phải FDI, skill này không áp dụng.
  - Thuế quan ảnh hưởng chính sách Fed → `du-doan-fed`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Chênh lệch thuế theo nước | Mức thuế đối ứng của Việt Nam so với đối thủ cùng mặt hàng quyết định ai rẻ hơn ở thị trường nhập khẩu | Mức thuế từng nước, ngày hiệu lực: `web_search` (văn bản, cơ quan thương mại), ghi nguồn + ngày |
| Thuế theo mặt hàng, xuất xứ | Thuế ngành áp mọi nước; danh sách miễn trừ; quy tắc xuất xứ và chống chuyển tải làm hàng có tỷ lệ nguyên liệu nhập cao bị áp mức khác | `web_search`, ghi văn bản + ngày |
| Kim ngạch theo nhóm hàng | Mỗi nhóm một chu kỳ | Số liệu theo nhóm hàng (Tổng cục Thống kê, Hải quan): `web_search`, ghi kỳ; tổng xuất khẩu: `vs_indicator_data(indicator="XK")` |
| Thị trường đích | Tỷ trọng Mỹ, EU, Trung Quốc… cho biết nhóm nào chịu thuế Mỹ nhiều nhất | `vs_xnk_detail(direction="xk")` — số liệu **theo nước**, không theo nhóm hàng |
| Nhập máy móc, linh kiện | Chỉ báo dẫn vài quý cho xuất khẩu cùng nhóm | Nhập khẩu theo nhóm hàng: `web_search`; nhập theo nước: `vs_xnk_detail(direction="nk")` |
| FDI | Vốn đăng ký và giải ngân mới | `vs_categories` → `vs_indicator_data(category_id=…, term_type_id=…)`; không có chuỗi thì `web_search` |
| Tỷ giá | Nội tệ yếu: kim ngạch quy đổi ra đồng tăng nhưng nguyên liệu nhập đắt hơn; nội tệ mạnh thì ngược lại | `vn_forex_ohlcv(pair="USDVND")` |

## Các bước

**Bước 1 (song song):** xác định nhóm hàng (và mã nếu hỏi một công ty: `symbol_lookup`,
`vn_company`, `financial_detail(symbol, statement=TM)` cho doanh thu theo thị trường).

**Bước 2 (song song):** `vs_indicator_data(indicator="XK")` (tổng xuất khẩu) ·
`vs_xnk_detail(direction="xk")` và `vs_xnk_detail(direction="nk")` (theo nước) ·
`web_search` cho kim ngạch xuất và nhập máy móc, linh kiện **theo nhóm hàng** (ghi kỳ,
nguồn).

**Bước 3 (song song):** `web_search` (mức thuế Việt Nam và đối thủ cho nhóm hàng, thuế
theo mặt hàng, quy tắc xuất xứ — ghi văn bản + ngày) · `vs_categories` →
`vs_indicator_data` (FDI) · `vn_forex_ohlcv` (USDVND).

**Bước 4:** đi cây, rồi **ghi một dòng tác động tỷ giá cạnh verdict** (đọc ở Bước 3).
Riêng mã: `financial_detail(symbol, statement=KQKD)`, `planned_targets`,
`analyst_consensus`; `peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định nhóm hàng đang hưởng hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Mức thuế Mỹ (theo nước + theo mặt hàng) áp lên nhóm hàng của Việt Nam so với đối
thủ chính?
├─ Cao hơn rõ và Mỹ là thị trường đích lớn của nhóm → ★ "Bị siết bởi chênh lệch thuế:
│  đơn hàng có thể dịch sang đối thủ, đọc tỷ trọng Mỹ và biên của doanh nghiệp"
├─ Thấp hơn hoặc ngang đối thủ, hoặc Mỹ không phải thị trường chính → tiếp Q2
└─ Chưa tra được mức thuế hiện hành → tiếp Q2, ghi "chưa xác nhận thuế"

Q2. Nhóm hàng theo chu kỳ nào?
├─ Điện tử, linh kiện, máy móc → tiếp Q3
├─ Dệt may, giày dép, đồ gỗ → tiếp Q4
└─ Nông, thuỷ sản → tiếp Q4

Q3 (công nghệ). Nhập khẩu máy móc, linh kiện cùng nhóm có tăng trước vài quý không?
├─ Có → ★ "Công suất mới đang lên: xuất khẩu nhóm này có nền tăng trong các quý tới"
└─ Không, hoặc chưa dựng được chuỗi theo nhóm hàng → tiếp Q4

Q4. Đơn hàng và giá xuất khẩu của nhóm?
├─ Kim ngạch và đơn hàng tăng, giá xuất giữ → ★ "Nhóm hàng đang hưởng: cầu thị trường
│  đích kéo"
├─ Kim ngạch tăng chủ yếu nhờ giá, khối lượng phẳng → ★ "Tăng nhờ giá: dễ đảo chiều
│  khi giá thế giới quay đầu"
├─ Kim ngạch hoặc đơn hàng giảm → ★ "Bị siết bởi cầu: tồn kho nhà nhập khẩu hoặc cầu
│  thị trường đích yếu"
└─ Không có số theo nhóm hàng → ★ "Chỉ có số tổng: không kết luận được cho nhóm hàng
   này, độ tin cậy thấp"

## Chỉ báo đặc thù ngành

Phân nhóm hàng và cách đọc cặp nhập – xuất ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Không có hệ số chung cho "ngành xuất khẩu": định giá doanh nghiệp theo ngành của nó
(dệt may, thuỷ sản, gỗ thường **P/E** và **P/B** theo chu kỳ đơn hàng). Trước khi chốt
kỳ vọng tăng trưởng, ghi rõ **tỷ trọng doanh thu từ thị trường chịu thuế cao** và giả
định thuế đang dùng.

## Rủi ro đặc thù

- Mức thuế theo nước thay đổi theo đàm phán; danh sách miễn trừ thay đổi theo đợt.
- Quy tắc xuất xứ, chống chuyển tải: hàng dùng nhiều nguyên liệu nhập có thể bị áp mức
  khác.
- Thuế carbon biên giới của EU với thép, nhôm, xi măng, phân bón.
- Điều tra chống bán phá giá, rào kiểm dịch với nông thuỷ sản.
- Tổng kim ngạch đẹp che nhóm hàng đang giảm.

## Ranh giới

- Không xác định pha thị trường, không nói "xuất khẩu mạnh nên ngành X dẫn sóng" →
  `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nêu mức thuế, danh sách miễn trừ, ngày hiệu lực từ trí nhớ: tra văn bản, ghi
  nguồn + ngày (luật này chỉ nằm ở đây).
- Không suy kết luận cho một nhóm hàng từ tổng kim ngạch.

## Giới hạn

- `vs_xnk_detail` chia theo nước, không theo nhóm hàng; số theo nhóm hàng cần nguồn công
  bố.
- Số thương mại theo tháng có độ trễ và có thể được điều chỉnh — ghi kỳ.
- Tỷ trọng FDI là số toàn quốc, không phải của một doanh nghiệp.

## Ví dụ

Hỏi: Xuất khẩu tăng mạnh thì nhóm hàng nào hưởng?
Đạt khi: tách được nhóm hàng (hoặc nói rõ chỉ có số tổng), có mức thuế so đối thủ kèm
nguồn, nhập máy móc cùng nhóm, một dòng tác động tỷ giá, verdict theo cây.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột kim ngạch theo nhóm hàng,
đường nhập máy móc với xuất hàng điện tử, cột tỷ trọng thị trường đích. Vẽ bằng
`chart_render` với `from_call` (mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình
thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần phân nhóm hàng, nguồn cho từng chuỗi và cách đọc cặp nhập – xuất |
