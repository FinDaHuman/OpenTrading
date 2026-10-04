---
name: danh-gia-vi-mo-quoc-te
description: Đánh giá kinh tế Mỹ/toàn cầu — chu kỳ, đường cong lợi suất, chế độ rủi ro, so VN.
when_to_use: "Hỏi kinh tế Mỹ/global: Fed (bối cảnh, không phải odds), lợi suất, việc làm, GDP các nước, risk regime. Không dùng khi: VN (danh-gia-vi-mo-viet-nam), xác suất Fed (du-doan-fed)."
activation: auto
requires_tools: [mcp__opentrading__fred_series]
tool_budget: 10
triggers:
  keywords: [kinh tế mỹ, recession, suy thoái, đường cong lợi suất, yield curve, risk-on, risk-off, fed bối cảnh, kinh tế toàn cầu]
version: 1.0.0
---

# Đánh giá vĩ mô quốc tế

## Workflow

| Wave | Tools |
|---|---|
| 1 | `fred_series`(DGS10) · `fred_series`(CPIAUCSL) · `yf_yield_curve` |
| 2 | `yf_regime_assets` · `assets_rotation` · `world_macro_country`(VN/CHINA theo câu hỏi) |
| 3 | `yf_global_indices` · `yf_commodities` · `world_fear_greed` |

## Verdict — 5 mục

Chu kỳ Mỹ (soft/hard landing, dựa DGS10+CPI+curve) · đường cong (inverted?) · chế độ toàn
cầu (RISK-ON/OFF từ rotation) · so VN-vs-global (GDP VN cross-ref S3) · biến số theo dõi.

## Chống tràn lan

- fred series GỌI THEO TÊN (≥3 series cùng lúc là dấu hiệu tràn lan — dừng). yf wave ≤3.

## Lỗi thường gặp

FRED thiếu key → unavailable, chuyển nhánh không-FRED + ghi chú. Curve flaky (từng
fail→tự hồi) → retry 1 lần sau backoff, rồi bỏ.

## Bằng chứng live (02-10-2026)

US10Y 5.24% / 2Y 4.61%, không đảo chiều · WorldBank GDP VN 8.02% · fear/greed crypto 70-74 (tham lam).

## Nghiệm thu

"Kinh tế Mỹ hiện tại" → 5 mục verdict, curve + ≥2 series fred có số.

## Ghi chú review

ỔN — giữ nguyên. Verdict bắt buộc có 1 dòng so sánh VN-vs-global (GDP VN cross-ref).
