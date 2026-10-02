---
name: du-doan-fed
description: Xác suất/kịch bản lãi suất Fed — odds, đường cong, lịch FOMC, hàm ý cho VN.
when_to_use: "Fed tháng tới, cắt hay giữ, FOMC, dot plot. Không dùng khi: bối cảnh vĩ mô Mỹ chung (danh-gia-vi-mo-quoc-te)."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 8
triggers:
  keywords: [fed, fomc, cắt giảm lãi suất, dot plot, xác suất fed, lãi suất mỹ]
version: 1.0.0
---

# Dự đoán Fed

## Workflow

| Wave | Tools |
|---|---|
| 1 | `world_prediction_odds`(query=fed) |
| 2 | `polymarket_event`(slug fed-decision-*) · `fred_series`(DGS10 [+ EFFR/DFII nếu cần]) |
| 3 | `yf_yield_curve` · `web_fetch`(fed.gov statement/nguồn chính thức trong odds) |

## Verdict — 5 mục

Xác suất từng kịch bản (cắt/giữ/tăng, prob_pct + volume + end-date) · đường cong ám chỉ ·
lịch FOMC kế tiếp · biến số theo dõi (CPI Mỹ, jobs) · hàm ý cho VN (tỷ giá, cross-ref S3/S16).

## Chống tràn lan

- CHỈ 1 event fed chính (slug mới nhất, đã sort vol24h) — không bắn 5 query biến thể.

## Lỗi thường gặp

Odds stale (end date qua) → lọc `end > today`. Gamma chết cả proxy+lần → nói rõ "không có
odds", KHÔNG thay bằng nhận định riêng.

## Bằng chứng live (02-10-2026)

"Fed Decision in October 2026": Yes(no change) **74.5% / No 25.5%**, volume24h 2.6M · curve US10Y 5.24% không đảo.

## Nghiệm thu

"Fed tháng tới" → prob ≥2 kịch bản + lịch họp + 1 dòng hàm ý VN.
