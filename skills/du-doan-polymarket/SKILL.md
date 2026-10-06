---
name: du-doan-polymarket
description: "Bảng xác suất Polymarket theo chủ đề (xác suất, khối lượng, độ tin cậy). Dùng khi hỏi odds một sự kiện hoặc \"bao giờ X\". Câu hỏi về Fed dùng du-doan-fed."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
triggers:
  keywords: [polymarket, odds, xác suất sự kiện, prediction market, bao giờ bitcoin, cá cược sự kiện]
version: 1.3.0
---

# Đọc xác suất Polymarket

Trả về bảng event có prob_pct + volume + liquidity + end-date, mỗi dòng đủ 2 cờ tin cậy. Drill-down tối đa 2 events/run — người dùng chọn, không tự mở cả top-10.

## Khi nào dùng

- Dùng khi: user hỏi odds/xác suất Polymarket theo chủ đề (kinh tế, bầu cử, crypto...), "market nào đang nóng", drill-down 1–2 events.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Fed chuyên biệt (cần curve + FOMC + hàm ý VN) → dùng `du-doan-fed`.
  - Bản đồ chính trị rộng cần ghép odds + tin GDELT → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Các bước

**Bước 1: Quét odds (bắt buộc).**

Chạy `world_prediction_odds` (query hoặc tag, limit=10). Query rỗng thì đổi tag tối đa 1 lần rồi kết luận "không có market cho chủ đề". User chỉ hỏi "đang nóng gì" và Wave 1 đủ ≥5 events thì dừng, không drill-down.

**Bước 2: Drill-down (tuần tự sau Bước 1, tối đa 2).**

Chạy `polymarket_event` cho slug user quan tâm (drill outcomes đầy đủ), event thứ 2 chỉ khi user hỏi rõ. Không chạy Bước 2 + 3 song song.

**Bước 3: Validate trước khi chốt.**

Slug sai/không tồn tại → đổi slug top kế tiếp 1 lần rồi ghi "không drill được event X". Jina proxy chậm thì tool tự fallback direct (xem warnings), chờ 1 lần, không retry dồn dập. Gamma chết cả 2 đường → ghi rõ "không có odds", không bịa xác suất.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Bảng event:** mỗi dòng {title · prob_pct từng outcome (đơn vị %) · volume24h (USD) · liquidity (USD) · end-date (ngày) · URL event}.
2. **Cờ tin cậy bắt buộc trên từng dòng:** (1) liquidity thấp (<50k USD) → "odds kém tin"; (2) end-date đã qua → LOẠI khỏi bảng.
3. **Kết luận:** 1 câu "thị trường đặt cược X với xác suất Y" (đơn vị %).
4. **Provenance:** mỗi dòng bắt buộc URL event.

## Ví dụ

**Ví dụ 1:**
Hỏi: Polymarket đang nóng gì về kinh tế
Trả lời: Fed T10/<số> no-change <số> (vol <số>M) · Brazil presidential detail OK · sort vol24h hoạt động → ≥5 events + cờ tin-cậy trên từng dòng.
