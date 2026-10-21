---
name: cong-nghe-vn
description: "Đọc ngành công nghệ VN: hợp đồng ký mới, khách hàng nước ngoài – nội địa, năng suất nhân sự, viễn thông – hạ tầng số. Dùng khi hỏi nhóm công nghệ hay công ty dịch vụ phần mềm."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_statements, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, web_search, symbol_lookup, vn_company]
triggers:
  keywords: [ngành công nghệ, nhóm công nghệ, cổ phiếu công nghệ, công nghệ thông tin, dịch vụ công nghệ, công ty phần mềm, xuất khẩu phần mềm, chuyển đổi số, hợp đồng ký mới, ngành viễn thông]
  exclude: [dẫn sóng, sóng ngành, đầu sóng, giữa sóng, cuối sóng, pha nào, giai đoạn nào, chu kỳ ngành, luân chuyển ngành, rotation, tin gì, tin tức, tin mới, so sánh, khuyến nghị, nên mua, nên bán]
version: 1.0.0
---

# Công nghệ Việt Nam — framework phân tích

Phần lớn doanh nghiệp công nghệ niêm yết ở Việt Nam là **dịch vụ công nghệ** (làm phần
mềm, tích hợp hệ thống cho khách nước ngoài và trong nước) và **viễn thông – hạ tầng số**
(internet, trạm, trung tâm dữ liệu). Với dịch vụ, chỉ báo đi trước là **giá trị hợp đồng
ký mới**: hợp đồng nhiều năm ký trong kỳ này vào doanh thu dần qua các quý sau, nên
doanh thu ghi nhận có thể chững đúng lúc đơn hàng đang mạnh. Ngành dựa vào người: doanh
thu trên mỗi nhân viên cho biết tăng trưởng đến từ năng suất hay từ thuê thêm người.

## Khi nào dùng

- Dùng khi: hỏi nhóm công nghệ được tiếp sức hay bị siết, công ty dịch vụ công nghệ còn
  dư địa không, hợp đồng ký mới nói lên gì.
- Khi KHÔNG dùng:
  - Pha thị trường, công nghệ có dẫn sóng không → `dinh-vi-chu-ky-vn`.
  - Phân tích toàn diện một mã → `phan-tich-chuyen-sau-1-ma`; chỉ định giá → `dinh-gia-chuyen-sau`.
  - Kết quả 4 quý của một mã, đọc BCTC thuần → `co-ban-chuyen-sau`.
  - Chỉ đọc biểu đồ kỹ thuật → `ky-thuat-chuyen-sau`.

## Trụ cột driver

| Driver | Cơ chế | Đọc bằng |
|---|---|---|
| Hợp đồng ký mới | Chỉ báo dẫn 1–3 kỳ của doanh thu dịch vụ; ký yếu trong khi doanh thu vẫn tăng = đang tiêu đơn cũ | Công bố của công ty: `news_symbol(symbol)`, `company_events(symbol)`, báo cáo kết quả qua `web_search`; doanh thu chưa thực hiện (CDKT) là phần nhỏ |
| Thị trường khách hàng | Nước ngoài (Nhật, Mỹ, châu Âu, châu Á) bám ngân sách công nghệ của khách và tỷ giá; trong nước bám đầu tư chuyển đổi số của nhà nước và doanh nghiệp | Doanh thu theo thị trường/mảng: `financial_detail(statement=TM)`, công bố công ty |
| Năng suất nhân sự | Doanh thu/nhân viên tăng = tăng trưởng nhờ năng suất, giá dịch vụ cao hơn; giảm = mở rộng bằng thuê người, biên chịu áp lực; tự động hoá bằng AI có thể đổi giá dịch vụ truyền thống | Số nhân viên: báo cáo thường niên, công bố (`news_symbol`, `web_search`); doanh thu: KQKD |
| Viễn thông, hạ tầng số | Thuê bao, doanh thu bình quân/thuê bao, đầu tư mạng và trung tâm dữ liệu; khấu hao lớn | `financial_detail` (KQKD, LCTT), công bố công ty |

## Các bước

`financial_detail` nhận **một** `statement` mỗi lời gọi; không gọi được thì dùng
`financial_statements` và ghi rõ.

**Bước 1 (song song):** `symbol_lookup` · `vn_company` · `financial_detail(symbol,
statement=TM)` (doanh thu theo mảng, thị trường). Xác định **mảng đóng góp lợi nhuận
lớn nhất**.

**Bước 2 (song song):** `news_symbol(symbol)` + `company_events(symbol)` (hợp đồng ký
mới, thương vụ lớn) · `web_search` (báo cáo kết quả kinh doanh có số ký mới, số nhân
viên). `news_market` không lọc theo mã nên không dùng cho bước này.

**Bước 3 (song song):** `financial_detail(symbol, statement=KQKD)` (doanh thu, giá vốn,
chi phí) · `financial_detail(symbol, statement=CDKT)` (doanh thu chưa thực hiện, phải
thu), 4–8 quý. Tự tính doanh thu/nhân viên khi có số nhân viên, ghi rõ.

**Bước 4:** `planned_targets` · `analyst_consensus`. So với doanh nghiệp cùng mô hình
(dịch vụ với dịch vụ, viễn thông với viễn thông); chỉ báo vận hành đọc bằng
`financial_detail` từng mã, `peer_compare` chỉ trả P/E, P/B, EPS, BVPS, ROE/ROA.

## Cây quyết định công ty công nghệ đang được tiếp sức hay bị siết

Duyệt từ Q1, **dừng ở ★ đầu tiên**. Nhánh "không có số" đi tiếp với độ tin cậy thấp.

Q1. Mảng đóng góp lợi nhuận lớn nhất?
├─ Dịch vụ công nghệ (phần mềm, tích hợp) → tiếp Q2
└─ Viễn thông, hạ tầng số → ★ "Bám thuê bao, doanh thu/thuê bao và chi phí đầu tư
   mạng: đọc khấu hao và dòng tiền tự do thay vì hợp đồng ký mới"

Q2. Hợp đồng ký mới có đang dẫn doanh thu không?
├─ Ký mới giảm trong khi doanh thu vẫn tăng → ★ "Doanh thu đang tiêu đơn cũ: tăng
│  trưởng có thể chậm lại trong 2–3 kỳ tới"
├─ Ký mới tăng hoặc giữ → tiếp Q3
└─ Không có số ký mới → tiếp Q3, ghi rõ

Q3. Thị trường chính của mảng dịch vụ?
├─ Nước ngoài, tập trung vào một thị trường → ★ "Rủi ro tập trung: ngân sách công nghệ
│  và tỷ giá của một thị trường quyết định cả mảng"
├─ Nước ngoài đa dạng, hoặc trong nước → tiếp Q4
└─ Không tách được → tiếp Q4

Q4. Doanh thu/nhân viên đi đâu?
├─ Tăng hoặc giữ khi doanh thu tăng → ★ "Được tiếp sức: tăng trưởng nhờ đơn hàng và
│  năng suất, không chỉ thuê thêm người"
├─ Giảm vì thuê nhanh hơn doanh thu → ★ "Mở rộng bằng nhân sự: biên chịu áp lực cho
│  tới khi người mới tạo doanh thu"
└─ Không có số nhân viên → ★ "Đơn hàng và thị trường thuận, chưa đo được năng suất:
   độ tin cậy trung bình"

## Chỉ báo đặc thù ngành

Cách đọc hợp đồng ký mới, doanh thu theo mảng và năng suất ở `references/kpi.md`.

## Định giá theo đặc thù ngành

Dịch vụ công nghệ: **P/E** so với tăng trưởng lợi nhuận (PEG); lãi phụ thuộc một hợp
đồng lớn thì ghi rõ chất lượng lãi. Viễn thông, hạ tầng số: **EV/EBITDA** vì khấu hao
lớn. Doanh nghiệp nhiều mảng (công nghệ, viễn thông, giáo dục): định giá từng mảng cộng
lại, ghi rõ giả định.

## Rủi ro đặc thù

- Ký mới yếu thì doanh thu chậm lại sau vài kỳ.
- Một thị trường khách hàng giảm ngân sách hoặc đồng tiền của thị trường đó mất giá.
- Tự động hoá làm giảm giá dịch vụ lập trình truyền thống.
- Mảng trong nước phụ thuộc giải ngân đầu tư công.
- Cạnh tranh nhân sự đẩy chi phí lương.

## Ranh giới

- Không xác định pha thị trường, không nói "công nghệ sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Không khuyến nghị mua/bán.
- Không nội suy doanh thu từ một hợp đồng lớn: hợp đồng nhiều năm vào doanh thu theo
  tiến độ.
- Không dùng chỉ số công nghệ quốc tế thay chỉ báo của doanh nghiệp trong nước.

## Giới hạn

- Hợp đồng ký mới và số nhân viên là công bố không định kỳ — ghi kỳ, ghi rõ khi thiếu.
- Mảng nước ngoài chịu tỷ giá: biên quý có thể đổi vì tỷ giá, không vì vận hành.

## Ví dụ

Hỏi: Công ty dịch vụ công nghệ còn dư địa không?
Đạt khi: có hợp đồng ký mới (hoặc ghi thiếu) kèm nguồn, doanh thu theo thị trường,
doanh thu/nhân viên 2 kỳ, verdict theo cây kèm nhánh đã dừng.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ: cột doanh thu theo mảng/thị
trường, đường ký mới với doanh thu ghi nhận, cột doanh thu/nhân viên. Vẽ bằng
`chart_render` với `from_call` (mã `[ref …]`) từ kết quả tool đã có; cần chọn loại hình
thì nạp `ve-bieu-do`.

## File tham chiếu

| File | Dùng khi |
|---|---|
| `references/kpi.md` | Cần cách đọc hợp đồng ký mới, dòng BCTC theo statement và công thức doanh thu/nhân viên |
