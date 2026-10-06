---
name: nhip-dap-crypto
description: "Nhịp đập crypto bằng ngôn ngữ thường cho người ít chuyên: xu hướng giá, đòn bẩy funding/OI có nóng không, fear/greed, giá quy VND. Luôn dùng skill này khi user hỏi BTC/ETH/SOL sao rồi, crypto lên hay xuống, funding rate, có nên quan tâm crypto không — ngay cả khi user không nói rõ muốn 'phân tích crypto'."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
tool_budget: 6
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, tiền số, tiền ảo, funding]
version: 1.2.0
---

# Reading Crypto Pulse in Plain Language

Viết cho người ít chuyên crypto: mọi thuật ngữ bắt buộc giải thích 1 dòng kèm theo số. Trả lời đúng 3 câu. Crypto chạy 24/7 nên số "hôm nay" khác phiên chứng khoán VN — đừng so lệch phiên.

## When to Use

- Dùng khi: user hỏi BTC/ETH/SOL sao rồi, crypto lên hay xuống, funding/OI nói gì, giá crypto quy ra VND, crypto có liên thông gì tới chứng khoán VN.
- Khi KHÔNG dùng (dùng skill khác thay thế): bối cảnh regime vĩ mô toàn cầu (chỉ dùng `danh-gia-vi-mo-quoc-te`); odds xác suất sự kiện crypto (chỉ dùng `du-doan-polymarket`); phân tích vàng/tỷ giá (chỉ dùng `phan-tich-vang-ty-gia`).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: giá spot (tối đa 3 đồng)
- [ ] Step 2: đòn bẩy derivs
- [ ] Step 3: sentiment + giá VND
- [ ] Step 4: verdict 3 câu
```

**Step 1: Giá spot.**

Chạy `crypto_spot` (BTC ETH SOL — tối đa 3 đồng/wave 1). Giá + % 24h = "tăng/giảm bao nhiêu hôm nay".

**Step 2: Đòn bẩy derivs.**

Chạy `crypto_derivs` (BTC ETH). Giải thích kèm số: funding rate = "phe mua đang trả tiền cho phe bán (dương = đám đông cược lên)"; OI = "tổng tiền đang cược"; long/short = "bên nào đông hơn"; funding cao + OI cao = đòn bẩy nóng, dễ đảo chiều. Funding/OI rỗng do Binance geo-block từ worker Singapore thì ghi "không lấy được do giới hạn vùng", không kết luận thị trường chết.

**Step 3: Sentiment + giá VND.**

Chạy `world_fear_greed` + `vn_crypto_ohlcv` (path quy VND). Chỉ drill Polymarket crypto khi user hỏi xác suất; không tự lan sang odds/event-study.

## Template

ALWAYS use this exact verdict structure (đúng 3 câu):

1. Xu hướng gì (lên/xuống/đi ngang + %). 2. Đòn bẩy có nóng không (funding cao + OI cao = dễ đảo chiều). 3. Liên thông gì tới VN (giá VND + chứng khoán còn lại — không có thì ghi "độc lập").

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: BTC sao rồi
Output: BTC 83,476 (+0.33%) · funding 2.8e-05 (trung tính) · OI 95.7k · fear/greed 70-74 → 3 câu trả lời + 0 jargon không giải thích, ≤6 calls.
