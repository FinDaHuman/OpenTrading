---
name: nhip-dap-crypto
description: "Crypto pulse in plain language for non-experts: price trend, whether leverage funding/OI is heating up, fear/greed, VND-converted price. Always use this skill when the user asks how BTC/ETH/SOL is doing, whether crypto is up or down, funding rate, whether they should care about crypto — even when the user doesn't say explicitly they want 'phân tích crypto'."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
tool_budget: 6
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, tiền số, tiền ảo, funding]
version: 1.3.0
---

# Reading Crypto Pulse in Plain Language

Written for people who aren't crypto experts: every term must be explained in 1 line alongside its number. Answer in exactly 3 sentences. Crypto runs 24/7 so "today" numbers differ from VN stock sessions — don't compare across mismatched sessions. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks how BTC/ETH/SOL is doing, whether crypto is up or down, what funding/OI says, crypto price converted to VND, how crypto links to VN stocks.
- When NOT to use (use a different skill instead): global macro regime context (only `danh-gia-vi-mo-quoc-te`); crypto event probability odds (only `du-doan-polymarket`); gold/FX analysis (only `phan-tich-vang-ty-gia`).

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: spot prices (max 3 coins)
- [ ] Step 2: derivatives leverage
- [ ] Step 3: sentiment + VND price
- [ ] Step 4: 3-sentence verdict
```

**Step 1: Spot prices.**

Run `crypto_spot` (BTC ETH SOL — max 3 coins/wave 1). Price + % 24h = "tăng/giảm bao nhiêu hôm nay". NEVER use `vn_crypto_ohlcv` as a substitute (VND-converted price ≠ real USD price) — that tool is only for Step 3 when the user asks the VND price.

**Step 2: Derivatives leverage.**

Run `crypto_derivs` (BTC ETH). Explain alongside the numbers: funding rate = "phe mua đang trả tiền cho phe bán (dương = đám đông cược lên)"; OI = "tổng tiền đang cược"; long/short = "bên nào đông hơn"; high funding + high OI = hot leverage, prone to reversal. Funding/OI empty because Binance geo-blocks the Singapore worker → write "không lấy được do giới hạn vùng", don't conclude the market is dead.

**Step 3: Sentiment + VND price.**

Run `world_fear_greed` + `vn_crypto_ohlcv` (VND-conversion path). Only drill into Polymarket crypto when the user asks probabilities; don't drift into odds/event-study on your own.

## Template

ALWAYS use this exact verdict structure (exactly 3 sentences):

1. What the trend is (up/down/sideways + %). 2. Whether leverage is hot (high funding + high OI = prone to reversal). 3. What it links to for VN (VND price + rest for stocks — if none, write "độc lập").

## Examples

**Example 1 (live 02-10-2026, no new fabricated numbers):**
Input: BTC sao rồi
Output: BTC 83,476 (+0.33%) · funding 2.8e-05 (trung tính) · OI 95.7k · fear/greed 70-74 → 3-sentence answer + 0 unexplained jargon, ≤6 calls.
