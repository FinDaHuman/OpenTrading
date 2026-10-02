---
name: nhip-dap-crypto
description: Nhịp đập crypto — giá, funding, OI, sentiment, nến quy VND.
when_to_use: "BTC/ETH sao rồi, funding rate, crypto quy VND. Không dùng khi: allocation toàn cầu (luan-chuyen-tai-san-toan-cau), odds sự kiện crypto (du-doan-polymarket)."
activation: auto
requires_tools: [mcp__opentrading__crypto_spot]
tool_budget: 8
triggers:
  keywords: [btc, bitcoin, eth, ethereum, crypto, funding, open interest, binance]
version: 1.0.0
---

# Nhịp đập crypto

## Workflow

| Wave | Tools |
|---|---|
| 1 | `crypto_spot`(≤5 symbols) · `crypto_derivs`(BTC ETH SOL) · `world_fear_greed` |
| 2 | `vn_crypto_ohlv`(path quy VND) · `yf_commodities`(BTC ref) |
| 3 | `polymarket_event`/`world_prediction_odds`(crypto markets — chỉ khi user hỏi xác suất) |

## Verdict — 4 mục

Giá + 24h volume · leverage read (funding, OI, long/short) · fear/greed + label · path VND
(điểm khác biệt của bộ tool này) · rủi ro chính sách nếu có tin (chỉ khi user hỏi).

## Bằng chứng live (02-10-2026)

BTC 83,476 (+0.33%) · funding 2.8e-05 · OI 95.7k · fear/greed 70-74.

## Nghiệm thu

"Crypto sao rồi" → 4 mục verdict; funding/OI fail một symbol không làm chết batch (per-symbol error).
