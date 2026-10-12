---
name: co-ban-chuyen-sau
description: "Đọc BCTC một mã: chất lượng lợi nhuận, M-Score, F-score, cổ đông lớn, insider, cổ tức. Dùng khi hỏi BCTC có gì lạ, có thao túng không, cổ tức."
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
triggers:
  keywords: [bctc, báo cáo tài chính, phân tích cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.4.0
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

Chạy song song 2 calls: `financial_detail` (statement=KQKD, periods_n=4) + `stock_forensic` (symbol). Nếu user chỉ hỏi chất lượng (`chataluong`) thì dừng ngay tại đây.

**Bước 2: Mở rộng theo aspect (mỗi aspect là 1 leg, chỉ chạy leg được hỏi).**

- Trend/ratios: `financial_statements` · `financial_ratios` · `vn_fundamentals` (tối đa 3 calls).
- Sở hữu/kế hoạch (`sohuu`/`cophieu`/`kehoach`): `planned_targets` · `holders` · `insider_trading` · `dividends_splits` (+ Bước 1 nếu cần nền).
- Tham chiếu: `vs_financial_norms` / `vs_financial_terms` / `vs_company_info` — chỉ khi cần giải thích norm_id/kỳ.
- Không bao giờ gọi `vs_documents` ở đây (đó là tool của `tim-co-hoi-bao-cao-ctck). LCTT/CDKT chỉ gọi khi user hỏi explicitly dòng tiền/bảng cân đối qua param `statement`.

**Bước 3: Validate trước khi chốt verdict.**

Leg nào rỗng thì verdict partial + ghi rõ nguồn thiếu, không bịa số lấp chỗ trống. Bank cho M partial (SGAI null do LCTT rỗng — VCB live) thì ghi "M không kết luận", không gán M=0. `financial_detail` periods vượt gói → rows rỗng + warning → degrade sang `vs_financeinfo` đúng 1 lần, ghi rõ fallback. `vn_company` chậm ~30s khi throttle thì đặt cuối, thiếu thì ghi thiếu.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + trend + provenance:

1. Chất lượng tăng trưởng: DT/LN 4 quý + trend QoQ/YoY + biên (`provenance: financial_detail`).
2. Ratios chủ chốt (`provenance: financial_ratios` / `vn_fundamentals`).
3. M-Score + F-score + red flags (`provenance: stock_forensic`).
4. So với kế hoạch: vượt/hụt % (`provenance: planned_targets`).
5. Cấu trúc sở hữu + thay đổi insider (`provenance: holders` / `insider_trading`).
6. Chính sách cổ tức (`provenance: dividends_splits`).
7. Kết luận 1 câu: CƠ BẢN TỐT/TRUNG BÌNH/YẾU + 3 rủi ro lớn nhất.

**Giải thích con số forensic (bắt buộc khi có leg 3):** không chỉ liệt kê số — đọc `references/forensic-guide.md` rồi giải thích từng biến M-Score (DSRI/GMI/AQI/SGI/SGAI/LVGI/TATA, ngưỡng −1.78) và từng điểm F-score mất/giữ (kỳ nào, dòng nào). Bank M partial thì ghi "M không kết luận" theo file.

## Ví dụ

**Ví dụ 1:**
Hỏi: BCTC FPT có gì lạ
Trả lời (Wave 1 đủ, 2 calls): M-Score/F-score + 4 quý DT/LN + verdict 7 mục, không mở Wave 3–4.

**Ví dụ 2:**
Hỏi: cơ bản FPT
Đạt khi: có M-Score/F-score, 4 quý doanh thu/lợi nhuận, cổ đông lớn và cổ tức lấy từ tool; mục nào tool trả rỗng (ví dụ insider) thì ghi rõ là dữ liệu trống.

## File tham khảo

| File | Dùng khi |
|---|---|
| `references/forensic-guide.md` | Giải thích từng biến M-Score / điểm F-score + ngoại lệ ngân hàng (chỉ khi chạy leg forensic) |

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: stacked P&L cấu phần, waterfall P&L, pie ownership, bar KH/dividends.
