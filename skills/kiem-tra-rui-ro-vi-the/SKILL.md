---
name: kiem-tra-rui-ro-vi-the
description: Kiểm tra rủi ro TRƯỚC khi vào vị thế — GO/HALF/NO-GO, max size, invalidation, unknowns.
when_to_use: "Mua X size Y được không, rủi ro vị thế VCB. Không dùng khi: backtest chiến lược (kiem-chien-luoc-backtest), phân tích thuần (phan-tich-chuyen-sau-1-ma)."
activation: auto
requires_tools: [mcp__opentrading__quant_risk]
tool_budget: 12
triggers:
  keywords: [rủi ro vị thế, mua được không, size, position, stop loss, cắt lỗ, vào tiền, check risk]
version: 1.0.0
---

# Kiểm tra rủi ro vị thế

## Workflow

| Wave | Tools |
|---|---|
| 1 | `vn_quote_history`(mã 1, days=90) → `quant_risk`(returns, 252) |
| 2 | `scenario_simulate`(−5%, scale size) · `correlation_matrix`(symbols) |
| 3 | `stock_forensic` × từng mã (≤4) |
| 4 | `company_events` + `event_calendar_vn` (blackout 10 ngày) · `valuation_run` ×mã |

## Verdict

**GO / HALF / NO-GO** + max size VND + giá invalidation + 3 unknowns.
Rubric: M-Score đỏ → skip/halve; Sharpe âm + win <45% → HALF trở xuống; blackout (BCTC/ĐHĐCĐ
≤10 ngày) → halve; cushion định giá quyết định GO.

## Chống tràn lan

- `quant_risk` nhận returns từ wave 1 — KHÔNG gọi 90 ngày cho 8 mã (>4 mã → từ chối, yêu cầu chọn); correlation cap 8.

## Bằng chứng live (02-10-2026)

VCB 63 phiên — Sharpe **−1.15**, maxDD 12.3%, win 41.3% · corr VCB-HPG **0.50** · VCB M
partial/F 4/6, HPG M −2.24/F 2/6 · cổ tức VCB ex 23-07 (không blackout) · −5% = −2,870đ/1000cp
⇒ ~−5tr trên 100tr → HALF.

## Nghiệm thu

"Mua 100tr VCB HPG được không" → verdict 3 thành phần + rubric chỉ ra leg nào quyết định.
