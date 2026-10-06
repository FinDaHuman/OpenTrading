---
name: du-doan-polymarket
description: Đọc xác suất Polymarket theo chủ đề (bảng event + prob_pct + volume + cờ tin cậy liquidity/end-date). Luôn dùng skill này khi user hỏi odds/xác suất, market nào đang nóng, hay "bao giờ X" — ví dụ "odds bầu cử Mỹ", "BTC bao giờ chạm 100k" — ngay cả khi user không nói rõ muốn "xem Polymarket". Không dùng cho Fed chuyên biệt (dùng du-doan-fed).
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 6
triggers:
  keywords: [polymarket, odds, xác suất, prediction market, bao giờ bitcoin, cá cược sự kiện]
version: 1.1.0
---

# Reading Polymarket Odds

Trả về bảng event có prob_pct + volume + liquidity + end-date, mỗi dòng đủ 2 cờ tin cậy. Drill-down tối đa 2 events/run — người dùng chọn, không tự mở cả top-10.

## When to Use

- Dùng khi: user hỏi odds/xác suất Polymarket theo chủ đề (kinh tế, bầu cử, crypto...), "market nào đang nóng", drill-down 1–2 events.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Fed chuyên biệt (cần curve + FOMC + hàm ý VN) → dùng `du-doan-fed`.
  - Bản đồ chính trị rộng cần ghép odds + tin GDELT → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: quét odds (1 call, lấy top đã sort vol24h)
- [ ] Step 2: drill-down event user quan tâm (tối đa 2)
- [ ] Step 3: bảng + cờ + kết luận 1 câu
```

**Step 1: Quét odds (bắt buộc).**

Chạy `world_prediction_odds` (query hoặc tag, limit=10). Query rỗng thì đổi tag tối đa 1 lần rồi kết luận "không có market cho chủ đề". User chỉ hỏi "đang nóng gì" và Wave 1 đủ ≥5 events thì dừng, không drill-down.

**Step 2: Drill-down (tuần tự sau Step 1, tối đa 2).**

Chạy `polymarket_event` cho slug user quan tâm (drill outcomes đầy đủ), event thứ 2 chỉ khi user hỏi rõ. Không chạy Step 2 + 3 song song.

**Step 3: Validate trước khi chốt.**

Slug sai/không tồn tại → đổi slug top kế tiếp 1 lần rồi ghi "không drill được event X". Jina proxy chậm thì tool tự fallback direct (xem warnings), chờ 1 lần, không retry dồn dập. Gamma chết cả 2 đường → ghi rõ "không có odds", không bịa xác suất.

## Template

ALWAYS use this exact verdict structure:

1. **Bảng event:** mỗi dòng {title · prob_pct từng outcome (đơn vị %) · volume24h (USD) · liquidity (USD) · end-date (ngày) · URL event}.
2. **Cờ tin cậy bắt buộc trên từng dòng:** (1) liquidity thấp (<50k USD) → "odds kém tin"; (2) end-date đã qua → LOẠI khỏi bảng.
3. **Kết luận:** 1 câu "thị trường đặt cược X với xác suất Y" (đơn vị %).
4. **Provenance:** mỗi dòng bắt buộc URL event.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Polymarket đang nóng gì về kinh tế
Output: Fed T10/2026 no-change 74.5% (vol 2.6M) · Brazil presidential detail OK · sort vol24h hoạt động → ≥5 events + cờ tin-cậy trên từng dòng.
