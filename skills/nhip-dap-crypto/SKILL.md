---
name: nhip-dap-crypto
description: "Summarises crypto in plain words: price trend, funding/OI, fear & greed, prices in VND. Use for BTC/ETH/SOL or the crypto market."
match_text: "Tóm tắt crypto bằng lời thường: xu hướng giá, funding/OI, fear & greed, giá quy ra VND. Dùng khi hỏi BTC/ETH/SOL hay thị trường crypto."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, tiền số, tiền ảo, funding]
version: 1.3.0
---

# Nhịp đập crypto

Write for readers new to crypto: every term must get a one-line explanation next to its number. Answer in exactly 3 sentences. Crypto trades 24/7, so "today's" figures differ from the Vietnamese stock session — never compare mismatched sessions.

## Khi nào dùng

- Use when: the user asks how BTC/ETH/SOL are doing, whether crypto is up or down, what funding/OI say, crypto prices in VND, how crypto links to Vietnamese stocks.
- Do NOT use (use another skill instead): the global macro regime (use `danh-gia-vi-mo-quoc-te` only); event odds for crypto (use `du-doan-polymarket` only); gold/FX analysis (use `phan-tich-vang-ty-gia` only).

## Các bước

**Bước 1: Spot prices.**

Run `crypto_spot` (BTC ETH SOL — at most 3 coins in wave 1). Price + 24h % = "tăng/giảm bao nhiêu hôm nay". NEVER substitute `vn_crypto_ohlcv` (VND-converted prices ≠ real USD prices) — that tool is only for Bước 3 when the user asks for VND prices.

**Bước 2: Derivatives leverage.**

Run `crypto_derivs` (BTC ETH). Explain with numbers: funding rate = "phe mua đang trả tiền cho phe bán (dương = đám đông cược lên)"; OI = "tổng tiền đang cược"; long/short = "bên nào đông hơn"; high funding + high OI = hot leverage, prone to reversal. If funding/OI is empty because Binance geo-blocks the Singapore worker, write "không lấy được do giới hạn vùng"; do not conclude the market is dead.

**Bước 3: Sentiment + VND prices.**

Run `world_fear_greed` + `vn_crypto_ohlcv` (the VND path). Drill into Polymarket crypto only if the user asks for probabilities; never drift into odds/event studies yourself.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure (exactly 3 sentences):

1. The trend (up/down/sideways + %). 2. Whether leverage is hot (high funding + high OI = prone to reversal). 3. The link to Vietnam (VND price + the rest of the stock market — if none, write "độc lập").

## Ví dụ

**Ví dụ 1:**
Hỏi: BTC sao rồi
Đạt khi: a 3-sentence answer + 0 unexplained jargon, ≤6 calls.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar diverging %24h, bar funding, gauge fear/greed.
