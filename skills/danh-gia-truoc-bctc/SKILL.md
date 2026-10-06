---
name: danh-gia-truoc-bctc
description: Chấm grade A/B/C cho setup 1 mã trước thềm BCTC từ 6 leg (ngày công bố, trend, thao túng, kỳ vọng, positioning, đệm định giá). Luôn dùng skill này khi BCTC chưa ra mà user hỏi có nên mua/giữ qua báo cáo không — ví dụ "FPT sắp ra báo cáo có nên mua", "setup HPG trước BCTC ra sao" — ngay cả khi user không nói rõ muốn "đánh giá setup".
activation: auto
requires_tools: [mcp__opentrading__company_events]
tool_budget: 10
triggers:
  keywords: [trước bctc, sắp ra báo cáo, pre earnings, công bố lợi nhuận, setup bctc]
version: 1.1.2
---

# Grading Pre-Earnings Setup

Chấm grade cho setup trước BCTC. Không forecast KQKD — không bao giờ đưa số DT/LN dự báo. BCTC đã ra rồi thì dừng ngay, chuyển sang `co-ban-chuyen-sau`, không cố chấm grade.

## When to Use

- Dùng khi: BCTC chưa ra và user hỏi setup trước BCTC (`FPT sắp ra báo cáo`, `đánh giá setup HPG trước BCTC`, `pre-earnings`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Phân tích mã thường (không gắn BCTC) → `phan-tich-chuyen-sau-1-ma`.
  - BCTC đã công bố, cần đọc số/M-Score → `co-ban-chuyen-sau`.
  - Hỏi kỹ thuật lẻ → `ky-thuat-chuyen-sau`.
  - Hỏi định giá lẻ → `dinh-gia-chuyen-sau`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: kiểm tra ngày công bố (thường không công khai — chỉ đối chiếu, không chốt)
- [ ] Step 2: reuse trend + thao túng từ co-ban-chuyen-sau
- [ ] Step 3: kỳ vọng + positioning (gọi trực tiếp)
- [ ] Step 4: reuse đệm định giá + grade A/B/C
```

**Step 1: Kiểm tra ngày công bố (chỉ đối chiếu, KHÔNG chốt dated).**

Ngày công bố BCTC tại VN thường KHÔNG công khai chính xác (công ty chỉ báo trước tháng/quý; `event_calendar_vn` không có earnings-date type). Chạy `company_events` + `news_symbol` chỉ để đối chiếu tin lịch công bố nếu user hỏi; nếu không thấy ngày rõ ràng → coi như `unknown ngày`, các leg ghi accordingly và grade tối đa B (đây là mặc định, không cần cố chốt ngày).

**Step 2: Reuse trend + thao túng (không gọi tool gốc).**

LOAD `co-ban-chuyen-sau` (gọi `load_skill` CHỈ với tên skill — không có file phụ `aspect=...`, aspect là các section trong body; load_skill file lạ sẽ fail). Sau khi load: dùng leg "Chất lượng tăng trưởng" (trend) + leg "M-Score + F-score" (thao túng) từ body skill đó. Lý do reuse thay vì gọi trực tiếp `financial_detail`/`stock_forensic`: tránh gọi chồng chéo cùng nguồn số trong 1 run. Ghi rõ reuse ở từng leg.

**Step 3: Kỳ vọng + positioning (gọi trực tiếp).**

Chạy `planned_targets` + `analyst_consensus` + `news_symbol` + `sentiment_score` (anchor = kế hoạch DN vì VN không có consensus EPS; sentiment là heuristic, không tính là leg xanh) và `insider_trading` + `money_flow` + `block_trades`. `planned_targets` trả số THẬT từ Vietstock CTKH (chain verified live) nhưng session-gated: Render/không session → `unavailable` — ghi trung thực "thiếu neo kế hoạch", không bịa số kế hoạch.

**Step 4: Reuse đệm định giá + chấm grade.**

LOAD `dinh-gia-chuyen-sau` + chạy `scenario_simulate` (−5%) để lấy size gợi ý. `scenario_simulate` là PHÉP TÍNH TUYẾN TÍNH chính xác trên giá close gần nhất (shock × giá, P/L/1000cp) — dùng để đệm cỡ vị thế, KHÔNG phải dự báo giá. Không gọi trực tiếp `valuation_run` ở đây. Đủ 6 leg evidence (kể cả partial) thì dừng — không gọi thêm vòng tin/dòng tiền thứ hai, không thêm leg thứ 7.

## Template

ALWAYS use this exact verdict structure:

1. Grade **A/B/C** (rubric: A = ≥5 leg xanh + M-Score sạch + KH rõ; B = 4–5 leg; C = <4 leg hoặc M-Score đỏ > −1.78).
2. 1 dòng evidence/leg (6 dòng, mỗi dòng số + trend + provenance).
3. Size đề xuất (từ `scenario_simulate` −5%).
4. Unknowns tường minh (liệt kê điều chưa biết).
5. Kết luận 1 câu: grade + có nên giữ/mua trước BCTC + rủi ro lớn nhất.

Partial data (thiếu positioning hoặc kỳ vọng) → verdict partial + unknowns. `sentiment_score` âm/dương nhẹ thì ghi đúng là heuristic, không nâng thành leg xanh/đỏ.

## Examples

**Example 1 (live 02-10-2026, FPT, không bịa số mới):**
Input: Đánh giá trước BCTC HPG
Output: M **−2.06** sạch · F 2/6 · KH DT 61,850/75,400/**58,580** · thưởng CP 10:1 ex 21-09 · sentiment heuristic −0.25 · NN bán ròng · pt 0% phiên → grade B + 6 leg evidence + unknowns, ≤10 calls (reuse legs).
