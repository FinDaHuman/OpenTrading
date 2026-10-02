---
name: phan-tich-chuyen-sau-1-ma
description: Phân tích TOÀN DIỆN một mã cụ thể — điều phối các skill chuyên (S22 kỹ thuật, S23 cơ bản, S24 định giá, S25 so sánh, S26 sentiment, S27 báo cáo CTCK) rồi gộp verdict. KHÔNG tự gọi chồng chéo hàng chục tools.
when_to_use: "Người dùng yêu cầu phân tích toàn diện một mã (phân tích FPT). Không dùng khi: user chỉ hỏi 1 chiều (RSI → ky-thuat-chuyen-sau; BCTC → co-ban-chuyen-sau; fair value → dinh-gia-chuyen-sau); hỏi thị trường chung → danh-gia-tinh-hinh-thi-truong."
activation: auto
requires_tools: [mcp__opentrading__stock_overview]
tool_budget: 6
triggers:
  keywords: [phân tích, phân tích cổ phiếu, phân tích mã, so sánh phân tích, toàn diện, chi tiết mã]
version: 1.0.0
---

# Phân tích chuyên sâu 1 mã (điều phối)

Skill điều phối: kích các skill chuyên làm việc chân, tự lo budget riêng (≤8 call mỗi skill),
rồi gộp verdict. CẤM gọi trực tiếp `signals_technical`/`financial_detail`/`valuation_run`/
`stock_forensic`… — ai cần chiều nào kích sub-skill chiều đó.

## Workflow

| Wave | Việc |
|---|---|
| 0 (pre-flight) | `source_status` (+ `vs_auth_status` nếu sẽ dùng vs_*) |
| 1 | `stock_overview(symbol)` · `symbol_lookup` nếu nghi tên — snapshot nhanh |
| 2 | `event_calendar_vn(symbol)` — lịch sự kiện 30 ngày tới |
| 3 (dispatch) | toan-dien → load_skill lần lượt: ky-thuat-chuyen-sau → co-ban-chuyen-sau → dinh-gia-chuyen-sau; focus đơn → chỉ skill tương ứng |
| 4 | `evidence_bundle` — khóa verdict từ các leg đã chạy |

## Verdict (6 mục, mỗi mục 1-2 dòng + provenance)

1. Kỹ thuật (từ S22) · 2. Cơ bản (S23) · 3. Định giá (S24) · 4. Dòng tiền/sự kiện ·
5. Sentiment/cơ hội (S26/S27) · 6. Bull-bear + điều kiện đổi nhận định.

## Chống tràn lan

- Budget 6 chỉ đếm tool nhà của skill; tool của sub-skill nằm trong budget sub-skill.
- User hỏi 1 chiều ("RSI FPT") → trả lời bằng sub-skill tương ứng, không chạy skill này.

## Lỗi thường gặp

Sub-skill chết 1 chân → vẫn ra verdict với leg còn sống + ghi leg thiếu, không bù số.

## Nghiệm thu

"Phân tích FPT" → verdict 6 mục; skill ≤6 calls nhà; không tool trùng giữa điều phối và sub-skill.
