---
name: dinh-gia-chuyen-sau
description: Định giá chuyên sâu 1 mã — vùng fair value (PER/PB/DCF-lite), so lịch sử, UPSIDE/DOWNSIDE %.
when_to_use: "FPT đắt chưa, VCB fair value, định giá theo PER. Không dùng khi: so sánh nhiều mã (so-sanh-cung-nganh), cơ bản thuần (co-ban-chuyen-sau)."
activation: auto
requires_tools: [mcp__opentrading__valuation_run]
tool_budget: 7
triggers:
  keywords: [định giá, fair value, dcf, per, đắt hay rẻ, upside, giá mục tiêu tự tính, valuation]
version: 1.0.0
---

# Định giá chuyên sâu 1 mã

## Workflow

| Wave | Tools |
|---|---|
| 1 | `valuation_run`(symbol, method) · `vs_overview_trading`(symbol) |
| 2 | `financial_ratios`(symbol) · `vn_quote_history`(symbol, days=365) |
| 3 (bối cảnh) | `yf_yield_curve` · `vs_trading_info`(symbol) |

## Verdict

Giá hiện tại vs vùng fair (method nào dẫn, chênh bao nhiêu %) · PER/PB hiện vs trung bình
2-3 năm (tự tính từ wave 2) · rẻ/đắt hợp lý vì sao (tăng trưởng, chất lượng co-ban-chuyen-sau
cross-ref, lãi suất leg 3) · **UPSIDE/DOWNSIDE %** + độ tin (cao nếu 2 method đồng thuận).

## Chống tràn lan

- DCF-lite trong `valuation_run` đã tính sẵn — KHÔNG tự dựng lại DCF.
- 1 `method` per run (auto trừ khi user khăng khăng); bond context chỉ khi PB-heavy.

## Lỗi thường gặp

`method` sai enum → warning, về auto. EPS âm (công ty lỗ) → per_pb vô nghĩa, nói thẳng
"không đủ cơ sở định giá". Bank (đặc thù PB) → ưu tiên per_pb.

## Bằng chứng live (02-10-2026)

VCB per_pb @57,400 (2 method đồng thuận) · FPT per_pb @62,700 · US10Y 5.24% context · overview_trading VCB PE/PB/ROEA đủ.

## Nghiệm thu

"FPT đắt chưa" → UPSIDE % + so lịch sử 2 dòng, ≤7 calls.

## Ghi chú review

ỔN — mỏng nhưng đúng bản chất định giá. Bổ sung duy nhất: verdict thêm dòng "upside theo target CTCK" (cross-ref tim-co-hoi-bao-cao-ctck) để neo kỳ vọng.
