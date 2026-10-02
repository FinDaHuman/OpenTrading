---
name: bat-on-quoc-gia
description: Đo bất ổn/ổn định của MỘT QUỐC GIA — 4 mức verdict từ GDELT counts + mức độ + transmission.
when_to_use: "Thái Lan đang bất ổn gì, đo độ ổn định Trung Quốc. Không dùng khi: nhiều nước so sánh (chạy lặp skill mỗi nước), bầu cử/chính sách toàn cầu (danh-gia-tinh-hinh-chinh-tri-toan-cau), chiến sự (danh-gia-tinh-hinh-xung-dot)."
activation: auto
requires_tools: [mcp__opentrading__geo_intel]
tool_budget: 6
triggers:
  keywords: [bất ổn, bất ổn quốc gia, biểu tình, đảo chính, ổn định, thái lan, bangladesh]
version: 1.0.0
---

# Bất ổn quốc gia

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1 | `geo_intel`(topic=tên nước EN) · `event_stats`(query=tên nước EN) | 2 call song song, cùng upstream GDELT |
| 2 | `news_market`(sources=gdelt, lọc theo tên nước) | chỉ khi wave 1 mỏng |
| 3 (tùy chọn impact) | `yf_commodities` hoặc `assets_rotation` 1 call | khi user hỏi "ảnh hưởng thị trường" |

## Verdict

Chỉ báo bất ổn 4 mức (ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG) dựa: tần suất event GDELT
(so với baseline chính query đó — run này là baseline, run sau so sánh) · mức độ
(protest/conflict/coup keywords trong titles) · coverage nước láng giềng · transmission sang
giá (dầu/vàng/rotation nếu leg 3 chạy). Mỗi mục 1 dòng evidence + URL.

## Chống tràn lan

- 1 nước/run; query EN 1 lần + 1 biến thể; KHÔNG quét nhiều nước (user hỏi "ASEAN" → đề nghị tách từng nước).

## Lỗi thường gặp

GDELT rate-limit → 1 retry sau backoff (server đã cache 600s). Coverage mỏng là KẾT QUẢ
(nước ít tin — ghi chú "low-coverage ≠ stable").

## Bằng chứng live (02-10-2026)

geo_intel("Vietnam") + event_stats("vietnam") trả articles counts OK; pipeline EN-query thông.

## Nghiệm thu

"Bất ổn Thái Lan" → 4 mức verdict + ≥3 evidence lines có URL, ≤6 calls.
