---
name: nhip-dap-crypto
description: Nhịp đập crypto bằng ngôn ngữ thường — xu hướng gì, đòn bẩy có nóng không, liên thông gì tới VN.
when_to_use: "BTC/ETH sao rồi, crypto lên hay xuống, có nên quan tâm crypto không. Không dùng khi: bối cảnh regime toàn cầu (danh-gia-vi-mo-quoc-te), odds sự kiện crypto (du-doan-polymarket)."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
tool_budget: 6
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, tiền số, tiền ảo, funding]
version: 1.1.0
---

# Nhịp đập crypto (đơn giản hóa)

Skill này viết cho người ít chuyên crypto: mọi thuật ngữ đều giải thích 1 dòng kèm theo số.

## Workflow

| Wave | Tools | Đọc thế nào |
|---|---|---|
| 1 | `crypto_spot`(BTC ETH SOL) | Giá + % 24h = "tăng/giảm bao nhiêu hôm nay" |
| 2 | `crypto_derivs`(BTC ETH) | funding rate = "phe mua đang trả tiền cho phe bán (dương = đám đông cược lên)"; OI = "tổng tiền đang cược"; long/short = "bên nào đông hơn" |
| 3 | `world_fear_greed` · `vn_crypto_ohlv`(path quy VND) | Tham lam/Sợ hãi (0–100) + giá quy VND cho người VN |

## Verdict (3 câu hỏi)

1. Xu hướng gì (lên/xuống/đi ngang + %) · 2. Đòn bẩy có nóng không (funding cao + OI cao = dễ đảo chiều) · 3. Liên thông gì tới VN (giá VND + chứng khoán còn lại — không thì ghi "độc lập").

## Cảnh báo bắt buộc

- Binance có thể geo-block từ worker Singapore (funding rỗng = ghi chú, không phải thị trường chết).
- Crypto chạy 24/7 — số "hôm nay" khác phiên chứng khoán VN, đừng so lệch phiên.

## Chống tràn lan

Tối đa 3 đồng/wave 1; không drill polymarket crypto trừ khi user hỏi xác suất.

## Bằng chứng live (02-10-2026)

BTC 83,476 (+0.33%) · funding 2.8e-05 (trung tính) · OI 95.7k · fear/greed 70-74.

## Nghiệm thu

"BTC sao rồi" → 3 câu trả lời + 0 jargon không giải thích, ≤6 calls.
