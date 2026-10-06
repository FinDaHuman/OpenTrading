---
name: co-ban-chuyen-sau
description: Đọc BCTC và đánh giá chất lượng cơ bản của 1 mã (M-Score thao túng, F-score, tăng trưởng, sở hữu, cổ tức). Luôn dùng skill này khi user hỏi đọc BCTC, chất lượng lợi nhuận, M-Score, cổ đông lớn, insider hay cổ tức của một mã — ví dụ "BCTC FPT có gì lạ", "VCB có thao túng không", "cổ đông lớn HPG" — ngay cả khi user không nói rõ muốn "phân tích cơ bản".
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
tool_budget: 9
triggers:
  keywords: [bctc, báo cáo tài chính, cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.1.1
---

# Analyzing Single-Stock Fundamentals

Phân tích THUẦN cơ bản 1 mã theo aspect: hỏi khía cạnh nào thì chỉ chạy leg đó rồi dừng — đừng quét hết BCTC vì "cho chắc".

## When to Use

- Dùng khi: user hỏi BCTC, chất lượng lợi nhuận, M-Score/thao túng, F-score, kế hoạch kinh doanh, cổ đông lớn, insider, cổ tức của 1 mã.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Hỏi kỹ thuật (RSI, MACD, breakout, hỗ trợ/kháng cự) → `ky-thuat-chuyen-sau`.
  - Hỏi định giá (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - So sánh 2-6 mã → `so-sanh-cung-nganh`.
  - Phân tích toàn diện 1 mã → `phan-tich-chuyen-sau-1-ma`.
  - Đọc báo cáo CTCK (không phải BCTC gốc) → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 0: kiểm tra JWT sống hay chết
- [ ] Step 1: lõi BCTC + chất lượng (aspect chataluong dừng tại đây)
- [ ] Step 2-3: chỉ chạy aspect user hỏi (trend/ratios, sở hữu/kế hoạch)
- [ ] Step 4: chốt verdict 7 mục + provenance
```

**Step 0: Kiểm tra JWT (bắt buộc, gọi trực tiếp đầu tiên).**

Chạy `vs_auth_status`. JWT sống thì được dùng `financial_detail`; JWT chết thì chuyển nhánh mirror `vs_financeinfo` — hai tool này không bao giờ chạy song song vì cùng một nguồn số.

**Step 1: Lõi BCTC + chất lượng.**

Chạy song song 2 calls: `financial_detail` (statement=KQKD, periods_n=4) + `stock_forensic` (symbol). Nếu user chỉ hỏi chất lượng (`chataluong`) thì dừng ngay tại đây.

**Step 2: Mở rộng theo aspect (mỗi aspect là 1 leg, chỉ chạy leg được hỏi).**

- Trend/ratios: `financial_statements` · `financial_ratios` · `vn_fundamentals` (tối đa 3 calls).
- Sở hữu/kế hoạch (`sohuu`/`cophieu`/`kehoach`): `planned_targets` · `holders` · `insider_trading` · `dividends_splits` (+ Step 1 nếu cần nền).
- Tham chiếu: `vs_financial_norms` / `vs_financial_terms` / `vs_company_info` — chỉ khi cần giải thích norm_id/kỳ.
- Không bao giờ gọi `vs_documents` ở đây (đó là tool của `tim-co-hoi-bao-cao-ctck). LCTT/CDKT chỉ gọi khi user hỏi explicitly dòng tiền/bảng cân đối qua param `statement`.

**Step 3: Validate trước khi chốt verdict.**

Leg nào rỗng thì verdict partial + ghi rõ nguồn thiếu, không bịa số lấp chỗ trống. Bank cho M partial (SGAI null do LCTT rỗng — VCB live) thì ghi "M không kết luận", không gán M=0. `financial_detail` periods vượt gói → rows rỗng + warning → degrade sang `vs_financeinfo` đúng 1 lần, ghi rõ fallback. `vn_company` chậm ~30s khi throttle thì đặt cuối, thiếu thì ghi thiếu.

## Template

ALWAYS use this exact verdict structure, mỗi mục ghi số + trend + provenance:

1. Chất lượng tăng trưởng: DT/LN 4 quý + trend QoQ/YoY + biên (`provenance: financial_detail`).
2. Ratios chủ chốt (`provenance: financial_ratios` / `vn_fundamentals`).
3. M-Score + F-score + red flags (`provenance: stock_forensic`).
4. So với kế hoạch: vượt/hụt % (`provenance: planned_targets`).
5. Cấu trúc sở hữu + thay đổi insider (`provenance: holders` / `insider_trading`).
6. Chính sách cổ tức (`provenance: dividends_splits`).
7. Kết luận 1 câu: CƠ BẢN TỐT/TRUNG BÌNH/YẾU + 3 rủi ro lớn nhất.

**Giải thích con số forensic (bắt buộc khi có leg 3):** không chỉ liệt kê số — giải thích nghĩa từng biến và vì sao dẫn tới kết luận:
- M-Score từng biến: DSRI (chất lượng doanh thu — >1.03 nghi kê khớp doanh thu), GMI (biên gộp xấu đi), AQI (chất lượng tài sản), SGI (tăng trưởng), SGAI (chi phí bán hàng), LVGI (đòn bẩy), TATA (accruals). M < −1.78 = ít dấu thao túng; M > −1.78 = nghi ngờ.
- F-score từng điểm mất/giữ (ROA, CF>ROA, dROA, leverage, margin, turnover) — điểm mất vì sao (kỳ nào, dòng nào).
- Kết luận "sạch/đỏ" bắt buộc dẫn từng con số làm căn cứ, không kết luận chay.

## Examples

**Example 1:**
Input: BCTC FPT có gì lạ
Output (Wave 1 đủ, 2 calls): M-Score/F-score + 4 quý DT/LN + verdict 7 mục, không mở Wave 3–4.

**Example 2 (live 02-10-2026, không bịa số mới):**
Input: cơ bản FPT
Output: FPT detail 25 norms × 138 số · M **−2.06**, F 2/6 · KH DT 61,850/75,400/58,580 · VCB holders SBV 74.8% · VCB cổ tức 450đ · insider empty là đúng data.
