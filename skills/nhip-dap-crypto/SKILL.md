---
name: nhip-dap-crypto
description: "Tóm tắt crypto bằng lời thường: xu hướng giá, funding/OI, fear & greed, giá quy ra VND. Dùng khi hỏi BTC/ETH/SOL hay thị trường crypto."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, tiền số, tiền ảo, funding]
version: 1.3.0
---

# Nhịp đập crypto

Viết cho người ít chuyên crypto: mọi thuật ngữ bắt buộc giải thích 1 dòng kèm theo số. Trả lời đúng 3 câu. Crypto chạy 24/7 nên số "hôm nay" khác phiên chứng khoán VN — đừng so lệch phiên.

## Khi nào dùng

- Dùng khi: user hỏi BTC/ETH/SOL sao rồi, crypto lên hay xuống, funding/OI nói gì, giá crypto quy ra VND, crypto có liên thông gì tới chứng khoán VN.
- Khi KHÔNG dùng (dùng skill khác thay thế): bối cảnh regime vĩ mô toàn cầu (chỉ dùng `danh-gia-vi-mo-quoc-te`); odds xác suất sự kiện crypto (chỉ dùng `du-doan-polymarket`); phân tích vàng/tỷ giá (chỉ dùng `phan-tich-vang-ty-gia`).

## Các bước

**Bước 1: Giá spot.**

Chạy `crypto_spot` (BTC ETH SOL — tối đa 3 đồng/wave 1). Giá + % 24h = "tăng/giảm bao nhiêu hôm nay". CẤM dùng `vn_crypto_ohlcv` thay thế (giá quy VND ≠ giá USD thật) — tool đó chỉ dùng ở Bước 3 khi user hỏi giá VND.

**Bước 2: Đòn bẩy derivs.**

Chạy `crypto_derivs` (BTC ETH). Giải thích kèm số: funding rate = "phe mua đang trả tiền cho phe bán (dương = đám đông cược lên)"; OI = "tổng tiền đang cược"; long/short = "bên nào đông hơn"; funding cao + OI cao = đòn bẩy nóng, dễ đảo chiều. Funding/OI rỗng do Binance geo-block từ worker Singapore thì ghi "không lấy được do giới hạn vùng", không kết luận thị trường chết.

**Bước 3: Sentiment + giá VND.**

Chạy `world_fear_greed` + `vn_crypto_ohlcv` (path quy VND). Chỉ drill Polymarket crypto khi user hỏi xác suất; không tự lan sang odds/event-study.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau (đúng 3 câu):

1. Xu hướng gì (lên/xuống/đi ngang + %). 2. Đòn bẩy có nóng không (funding cao + OI cao = dễ đảo chiều). 3. Liên thông gì tới VN (giá VND + chứng khoán còn lại — không có thì ghi "độc lập").

## Ví dụ

**Ví dụ 1:**
Hỏi: BTC sao rồi
Trả lời: BTC <số> (<số>) · funding <số>e-05 (trung tính) · OI <số>k · fear/greed <số> → 3 câu trả lời + 0 jargon không giải thích, ≤6 calls.

## Trực quan hóa

Dữ liệu skill này nhận: %24h các coin, funding, fear/greed. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (bar diverging %24h, bar funding, gauge fear/greed), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
