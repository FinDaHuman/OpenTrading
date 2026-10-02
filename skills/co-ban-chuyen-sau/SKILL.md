---
name: co-ban-chuyen-sau
description: Phân tích THUẦN cơ bản 1 mã — BCTC từng dòng, chất lượng lợi nhuận (M-Score), kế hoạch, sở hữu, cổ tức.
when_to_use: "Đọc BCTC FPT, VCB có dấu hiệu thao túng không, cổ đông lớn HPG. Không dùng khi: kỹ thuật (ky-thuat-chuyen-sau), định giá (dinh-gia-chuyen-sau), so sánh nhiều mã (so-sanh-cung-nganh)."
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
tool_budget: 9
triggers:
  keywords: [bctc, báo cáo tài chính, cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.0.0
---

# Cơ bản chuyên sâu 1 mã

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 0 | `vs_auth_status` | JWT sống = được dùng `financial_detail`; chết → nhánh mirror |
| 1 | `financial_detail`(statement=KQKD, periods_n=4) · `stock_forensic`(symbol) | song song 2 |
| 2 (chọn) | `financial_statements` · `financial_ratios` · `vn_fundamentals` | trend + ratios; 3 call max |
| 3 (chọn) | `planned_targets` · `holders` · `insider_trading` · `dividends_splits` | sở hữu/kế hoạch/chia cổ tức |
| 4 (tham chiếu) | `vs_financial_norms`/`vs_financial_terms`/`vs_company_info` | CHỈ khi cần giải thích norm_id/kỳ |

## Verdict

Chất lượng tăng trưởng (DT/LN 4 quý, biên) · ratios chủ chốt · M-Score + F-score + red flags ·
so với kế hoạch (vượt/hụt %) · cấu trúc sở hữu + thay đổi insider · chính sách cổ tức.
Kết luận 1 câu: CƠ BẢN TỐT/TRUNG BÌNH/YẾU + 3 rủi ro lớn nhất.

## Chống tràn lan

- Aspect nào mới chạy leg đó — "chataluong" chỉ wave 1; "sohuu" chỉ wave 3.
- `vs_financeinfo` chỉ là fallback JWT-chết; `vs_documents` KHÔNG thuộc skill này (tim-co-hoi-bao-cao-ctck).
- LCTT/CDKT chỉ gọi khi user hỏi dòng tiền/bảng cân đối (statement param).

## Lỗi thường gặp

Bank m_partial (SGAI null do LCTT rỗng — VCB live) → "M không kết luận", không gán M=0.
`financial_detail` periods vượt gói → rows rỗng + warning → degrade `vs_financeinfo` 1 lần.
`financial_statements` warning "statement not found, returning all pages" = đặc trưng v3-compat
— đọc trang trong data, đừng abort. vn_company chậm 30s khi throttle → đặt cuối wave, thiếu được.

## Bằng chứng live (02-10-2026)

FPT detail 25 norms × 138 số · M **−2.06**, F 2/6 · KH DT 61,850/75,400/58,580 · VCB holders
SBV 74.8% · VCB cổ tức 450đ · insider empty là đúng data.

## Nghiệm thu

"BCTC FPT có gì lạ" → wave 1 (2 calls) đủ M/F + 4 quý; "toàn cảnh cơ bản VPL" → ≤9 calls, không leg gọi 2 lần.
