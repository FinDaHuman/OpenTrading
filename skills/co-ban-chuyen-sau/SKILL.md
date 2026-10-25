---
name: co-ban-chuyen-sau
description: "Đọc BCTC một mã: chất lượng lợi nhuận, M-Score, F-score, cổ đông lớn, insider, cổ tức. Dùng khi hỏi BCTC có gì lạ, có thao túng không, cổ tức."
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
triggers:
  keywords: [bctc, báo cáo tài chính, phân tích cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.6.0
---

# Phân tích cơ bản một mã

Phân tích THUẦN cơ bản 1 mã theo aspect: hỏi khía cạnh nào thì chỉ chạy leg đó rồi dừng — đừng quét hết BCTC vì "cho chắc".

## Khi nào dùng

- Dùng khi: user hỏi BCTC, chất lượng lợi nhuận, M-Score/thao túng, F-score, kế hoạch kinh doanh, cổ đông lớn, insider, cổ tức của 1 mã.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi kỹ thuật (RSI, MACD, breakout, hỗ trợ/kháng cự) → `ky-thuat-chuyen-sau`.
  - Hỏi định giá (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - So sánh 2-6 mã → `so-sanh-cung-nganh`.
  - Phân tích toàn diện 1 mã → `phan-tich-chuyen-sau-1-ma`.
  - Đọc báo cáo CTCK (không phải BCTC gốc) → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 0: Kiểm tra JWT (bắt buộc, gọi trực tiếp đầu tiên).**

Chạy `vs_auth_status`. JWT sống thì được dùng `financial_detail`; JWT chết thì chuyển nhánh mirror `vs_financeinfo` — hai tool này không bao giờ chạy song song vì cùng một nguồn số.

**Bước 1: Lõi BCTC + chất lượng.**

Sau `vs_auth_status`, chạy song song 2 data calls: `financial_detail` (statement=KQKD, periods_n=4) + `stock_forensic` (symbol). Đây là 3 calls tổng cộng khi JWT sống. Nếu JWT chết, dùng `vs_financeinfo` thay `financial_detail` như Bước 0. Nếu user chỉ hỏi chất lượng (`chataluong`) thì dừng ngay tại đây.

**Bước 2: Mở rộng theo aspect (mỗi aspect là 1 leg, chỉ chạy leg được hỏi).**

- Trend/ratios: `financial_statements` · `financial_ratios` · `vn_fundamentals` (tối đa 3 calls).
- Sở hữu/kế hoạch (`sohuu`/`cophieu`/`kehoach`): `planned_targets` · `holders` · `insider_trading` · `dividends_splits` (+ Bước 1 nếu cần nền).
- Tham chiếu: `vs_financial_norms` / `vs_financial_terms` / `vs_company_info` — chỉ khi cần giải thích norm_id/kỳ.
- Không bao giờ gọi `vs_documents` ở đây (đó là tool của `tim-co-hoi-bao-cao-ctck). LCTT/CDKT chỉ gọi khi user hỏi explicitly dòng tiền/bảng cân đối qua param `statement`.

**Bước 3: Validate trước khi chốt verdict.**

Leg nào rỗng thì verdict partial + ghi rõ nguồn thiếu, không bịa số lấp chỗ trống. Trong `stock_forensic`, kiểm tra `schema_version` ở cấp cao nhất; kiểm tra riêng `beneish.version`, `beneish.status`, `beneish.missing_inputs`, `piotroski.version`, `piotroski.status`, `piotroski.missing_inputs`, kỳ năm tài chính và phạm vi BCTC. Báo cáo quý ở leg tăng trưởng không thay được đầu vào năm của forensic. Chỉ đọc điểm của từng mô hình khi `status=complete` và `score` có giá trị; `partial`, `not_applicable`, `unsupported` hoặc `score=null` thì trình bày độ phủ và dữ liệu thiếu, không gán 0. Với ngân hàng/CTCK/bảo hiểm, Beneish `not_applicable`, Piotroski `unsupported`; không áp công thức doanh nghiệp thông thường. Một mã như FPT cũng có thể chuyển từ complete sang partial khi nguồn một dòng BCTC chưa được chứng minh đúng nghĩa. `financial_detail` periods vượt gói → rows rỗng + warning → degrade sang `vs_financeinfo` đúng 1 lần, ghi rõ fallback. `vn_company` chậm ~30s khi throttle thì đặt cuối, thiếu thì ghi thiếu.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + trend + provenance:

1. Chất lượng tăng trưởng: DT/LN 4 quý + trend QoQ/YoY + biên (`provenance: financial_detail`).
2. Ratios chủ chốt (`provenance: financial_ratios` / `vn_fundamentals`).
3. M-Score + F-score theo năm nếu hoàn chỉnh; nếu thiếu thì ghi `status`, độ phủ và nguồn thiếu (`provenance: stock_forensic`).
4. So với kế hoạch: vượt/hụt % (`provenance: planned_targets`).
5. Cấu trúc sở hữu + thay đổi insider (`provenance: holders` / `insider_trading`).
6. Chính sách cổ tức (`provenance: dividends_splits`).
7. Kết luận 1 câu: mức đánh giá cơ bản theo các leg có bằng chứng + 3 rủi ro lớn nhất; đánh dấu tạm thời khi forensic thiếu.

**Giải thích con số forensic (bắt buộc khi có leg 3):** không chỉ liệt kê số. Beneish chuẩn ở đây là mô hình **8 biến theo năm, có phiên bản**: DSRI (phải thu/doanh thu), GMI (biên gộp), AQI (tài sản ngoài tài sản ngắn hạn và PPE ròng), SGI (tăng trưởng doanh thu), DEPI (tỷ lệ khấu hao), SGAI (chi phí bán hàng và quản lý/doanh thu), LVGI (nợ dài hạn cộng nợ ngắn hạn/tổng tài sản), TATA (lợi nhuận kế toán trừ CFO, chia tổng tài sản cuối kỳ). Chỉ so ngưỡng nghiên cứu −1.78 khi đủ cả 8 biến, đúng kỳ/phạm vi/nguồn, `status=complete`; đây không phải ngưỡng đã hiệu chuẩn trên Việt Nam, và điểm ở hai phía đều không chứng minh có hay không gian lận. Không suy DEPI từ dòng không được kiểm chứng, không dùng số 0 hay biến trung tính để lấp chỗ trống. Cờ thành phần từ tool là tín hiệu cần rà soát, không phải bằng chứng thao túng; không tự đặt DSRI/SGI cutoff.

Piotroski chuẩn có **9 tín hiệu**: ROA dương, CFO dương, ROA tăng, CFO lớn hơn lợi nhuận trên cùng cơ sở tài sản, đòn bẩy giảm, current ratio tăng, không phát hành cổ phần mới, biên gộp tăng, vòng quay tài sản tăng. Chỉ báo điểm `x/9` khi đủ 9 tín hiệu hợp lệ; nếu thiếu, ghi `score=null`, `passed/evaluated`, `missing_inputs`, kỳ và dòng nguồn; đặc biệt không đoán current_portion_long_term_debt hoặc equity_issued. Không biến tín hiệu thiếu thành tín hiệu trượt. Kết luận phải dẫn số, kỳ, phạm vi và trạng thái mô hình, không gọi BCTC "sạch" chỉ vì điểm thấp hay thiếu dữ liệu.

## Ví dụ

**Ví dụ 1:**
Hỏi: BCTC FPT có gì lạ
Trả lời (Wave 1 đủ: 1 call `vs_auth_status` rồi 2 data calls): trạng thái/độ phủ M-Score và F-score theo năm + 4 quý DT/LN + verdict 7 mục; chỉ nêu điểm khi tool trả mô hình complete, không mở Wave 3–4.

**Ví dụ 2:**
Hỏi: cơ bản FPT
Đạt khi: đã kiểm tra trạng thái M-Score/F-score (điểm có thể null), 4 quý doanh thu/lợi nhuận, cổ đông lớn và cổ tức lấy từ tool; mục nào tool trả rỗng (ví dụ insider) thì ghi rõ là dữ liệu trống.


## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: stacked P&L cấu phần, waterfall P&L, pie ownership, bar KH/dividends.
