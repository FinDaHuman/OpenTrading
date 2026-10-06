---
name: dinh-gia-chuyen-sau
description: "Tính vùng fair value và UPSIDE/DOWNSIDE % cho 1 mã (PER/PB, so lịch sử 2-3 năm). Luôn dùng skill này khi user hỏi mã đắt hay rẻ, fair value bao nhiêu, upside còn bao nhiêu — ví dụ 'FPT đắt chưa', 'VCB fair value' — ngay cả khi user không nói rõ muốn 'định giá'."
activation: auto
requires_tools: [mcp__opentrading__valuation_run]
tool_budget: 7
triggers:
  keywords: [định giá, fair value, dcf, per, đắt hay rẻ, upside, giá mục tiêu tự tính, valuation]
version: 1.1.0
---

# Valuing Single-Stock Fair Value

Trả về đúng 6 mục: giá vs vùng fair → PER/PB vs lịch sử → vì sao rẻ/đắt → UPSIDE/DOWNSIDE % → neo target CTCK → kết luận 1 câu. EPS âm (công ty lỗ) thì per_pb vô nghĩa — nói thẳng không đủ cơ sở định giá thay vì bịa fair value.

## When to Use

- Dùng khi: user hỏi định giá 1 mã (`FPT đắt chưa`, `VCB fair value`, `định giá theo PER`, `upside còn bao nhiêu`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - So sánh nhiều mã → `so-sanh-cung-nganh`.
  - Cơ bản thuần (BCTC, M-Score, sở hữu) → `co-ban-chuyen-sau`.
  - Kỹ thuật thuần → `ky-thuat-chuyen-sau`.
  - Giá mục tiêu của CTCK (tổng hợp báo cáo sẵn có) → `tim-co-hoi-bao-cao-ctck` (chỉ cross-ref để neo kỳ vọng, không thay thế định giá tự tính).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: fair value lõi (song song)
- [ ] Step 2: neo lịch sử (song song)
- [ ] Step 3: bối cảnh lãi suất (chỉ bank/PB-heavy)
- [ ] Step 4: verdict 6 mục
```

**Step 1: Fair value lõi (song song, gọi trực tiếp).**

Chạy `valuation_run` (symbol, method mặc định auto — chỉ đổi method khi user khăng khăng) + `vs_overview_trading` (symbol).

**Step 2: Neo lịch sử (song song, gọi trực tiếp).**

Chạy `financial_ratios` (symbol) + `vn_quote_history` (symbol, days=365), tự tính PER/PB trung bình 2–3 năm. Thiếu lịch sử giá thì bỏ so lịch sử, verdict partial + ghi thiếu.

**Step 3: Bối cảnh lãi suất (chỉ khi cần).**

Chạy `yf_yield_curve` + `vs_trading_info` khi mã PB-heavy (bank). Có fair value + so lịch sử thì dừng, không mở Step 3 để câu giờ. Một `method` mỗi run; `method` sai enum → warning → về auto, không retry method lạ.

**Step 4: Validate trước khi chốt.**

Không tự dựng lại DCF (đã tính sẵn trong `valuation_run`). Không gọi `signals_technical` / `financial_detail` / `stock_forensic` ở đây; cần chất lượng cơ bản thì cross-ref `co-ban-chuyen-sau`, không gọi lại tool của skill đó. Bank ưu tiên per_pb, ghi rõ lý do.

## Template

ALWAYS use this exact verdict structure, mỗi mục ghi số + trend + provenance:

1. Giá hiện tại vs vùng fair: method nào dẫn, chênh bao nhiêu % (`provenance: valuation_run` + `vs_overview_trading`).
2. PER/PB hiện tại vs trung bình 2–3 năm tự tính (`provenance: financial_ratios` + `vn_quote_history`).
3. Rẻ/đắt vì sao: tăng trưởng + chất lượng (cross-ref `co-ban-chuyen-sau`) + lãi suất.
4. UPSIDE/DOWNSIDE % + độ tin (cao nếu 2 method đồng thuận).
5. Dòng neo kỳ vọng: upside theo target CTCK (`provenance: tim-co-hoi-bao-cao-ctck` cross-ref, chỉ tham chiếu).
6. Kết luận 1 câu: ĐẮT/HỢP LÝ/RẺ + UPSIDE/DOWNSIDE %.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: FPT đắt chưa
Output: VCB per_pb @57,400 (2 method đồng thuận) · FPT per_pb @62,700 · US10Y 5.24% context · overview_trading VCB PE/PB/ROEA đủ → UPSIDE % + so lịch sử 2 dòng, ≤7 calls.
