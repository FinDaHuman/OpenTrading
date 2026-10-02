---
name: danh-gia-truoc-bctc
description: "Đánh giá setup trước BCTC — grade A/B/C từ 6 leg: sự kiện, trend, thao túng, kỳ vọng, positioning, đệm."
when_to_use: "Mùa BCTC cận kề (FPT sắp ra báo cáo, đánh giá setup). Không dùng khi: phân tích mã thường (phan-tich-chuyen-sau-1-ma), BCTC đã công bố (co-ban-chuyen-sau)."
activation: auto
requires_tools: [mcp__opentrading__company_events]
tool_budget: 10
triggers:
  keywords: [trước bctc, sắp ra báo cáo, pre earnings, công bố lợi nhuận, setup bctc]
version: 1.0.0
---

# Đánh giá trước BCTC

## Workflow (6 leg)

| Leg | Tools | Ghi chú |
|---|---|---|
| 1 Ngày | `company_events` + `event_calendar_vn` | dated hay rumor? |
| 2 Trend | load `co-ban-chuyen-sau` (aspect=baokao) | reuse leg, không gọi lại financial_* chồng chéo |
| 3 Thao túng | co-ban-chuyen-sau (aspect=chataluong) | M-Score/Piotroski |
| 4 Kỳ vọng | `planned_targets` + `analyst_consensus` + `news_symbol` + `sentiment_score` | anchor = kế hoạch DN (VN không consensus EPS) |
| 5 Positioning | `insider_trading` + `money_flow` + `block_trades` | |
| 6 Đệm | load `dinh-gia-chuyen-sau` + `scenario_simulate`(−5%) | size gợi ý |

## Verdict

Grade **A/B/C** + 1 dòng evidence/leg + size đề xuất + unknowns tường minh.
Rubric: A = ≥5 leg xanh + M-Score sạch + KH rõ; B = 4-5 leg; C = <4 leg hoặc M-Score đỏ (> −1.78).

## Chống tràn lan

Không forecast KQKD. `sentiment_score` heuristic không được tính là leg xanh đầy đủ.

## Bằng chứng live (02-10-2026, FPT)

M **−2.06** sạch · F 2/6 · KH DT 61,850/75,400/**58,580** · thưởng CP 10:1 ex 21-09 ·
sentiment heuristic −0.25 · NN bán ròng · pt 0% phiên → grade B.

## Nghiệm thu

"Đánh giá trước BCTC HPG" → grade + 6 leg evidence + unknowns, ≤10 calls (reuse legs).
