---
name: du-doan-polymarket
description: Xác suất từ Polymarket theo chủ đề — bảng event + cờ tin-cậy (liquidity, end-date).
when_to_use: "Market nào đang nóng, odds bầu cử Mỹ, bao giờ BTC chạm 100k. Không dùng khi: Fed chuyên biệt (du-doan-fed), chính trị rộng (danh-gia-tinh-hinh-chinh-tri-toan-cau)."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 6
triggers:
  keywords: [polymarket, odds, xác suất, prediction market, bao giờ bitcoin, cá cược sự kiện]
version: 1.0.0
---

# Dự đoán Polymarket

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1 | `world_prediction_odds`(query hoặc tag, limit=10) | đã sort vol24h — tin dùng top |
| 2 | `polymarket_event`(slug — 1 event user quan tâm) | drill-down outcomes đầy đủ |
| 3 (chọn lọc ≤2) | `polymarket_event`(slug thứ 2) | tối đa 2 drill-down/run |

## Verdict

Bảng event {title · prob_pct từng outcome · volume24h · liquidity · end-date} + 2 cờ bắt
buộc: (1) liquidity thấp (<50k) → "odds kém tin"; (2) end-date đã qua → loại. Kết luận 1
câu "thị trường đặt cược X với xác suất Y".

## Chống tràn lan

- Drill-down tối đa 2 event/run — người dùng chọn, skill không tự mở cả top-10.
- Query rỗng → ĐỔI tag 1 lần rồi kết luận "không có market cho chủ đề".

## Lỗi thường gặp

Jina proxy chậm → tool tự fallback direct (warnings cho biết). Gamma chết cả 2 đường →
unavailable, nói rõ "không có odds", không bịa xác suất.

## Bằng chứng live (02-10-2026)

Fed T10/2026 no-change **74.5%** (vol 2.6M) · Brazil presidential detail OK · sort vol24h hoạt động.

## Nghiệm thu

"Polymarket đang nóng gì về kinh tế" → ≥5 event + cờ tin-cậy trên từng dòng.
