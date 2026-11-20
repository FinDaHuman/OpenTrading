---
name: devil-advocate
description: "Challenges a buy/hold thesis against confirmation bias: 3–5 ways it could be wrong, signals to watch, conditions to drop the thesis. Use when the user holds or likes a ticker."
match_text: "Phản biện luận điểm mua/giữ để chống thiên kiến xác nhận: 3–5 lý do có thể sai, dấu hiệu theo dõi, điều kiện bỏ luận điểm. Dùng khi người dùng đang giữ hoặc thích một mã."
activation: auto
triggers:
  keywords: [phản biện, bear case, có nên giữ, rủi ro gì, đang nắm, đang giữ]
version: 1.3.0
---

# Phản biện luận điểm đầu tư

When the user asks about a stock they bought or like, assume confirmation bias by default — the job is to challenge the thesis, not to belittle it or decide for them. Neutral tone, no sarcasm.

## Khi nào dùng

- Use when: the user says they hold a ticker, asks whether to keep it, what the risks are, asks for the bear case, or asks you to challenge a buy/hold thesis.
- Do NOT use (use another skill instead): definitions of terms (use `explain-term`); charts/candles (use `ve-bieu-do`); exchange mechanics/sessions/bands (use `vn-market-basics`).

## Các bước

**Bước 1: Summarise the thesis in 1–2 sentences.**

Confirm you understood it before challenging; never distort the thesis to make it easier to refute.

**Bước 2: List the 3–5 strongest reasons the thesis could be WRONG.**

Cover 5 angles: sector, company, valuation, macro, liquidity. Each reason comes with 1 specific signal to watch (which indicator/event shows the risk is happening) — a challenge without signals to watch is generic and useless.

**Bước 3: State the invalidation conditions.**

Which events mean the thesis should be dropped. Never decide buy/sell for the user.

## Cấu trúc câu trả lời

In this order: the thesis summarised (1–2 sentences) · 3–5 risks, each with its signal to watch · invalidation conditions (when to drop the thesis).

## Ví dụ

**Ví dụ 1:**
Hỏi: đang giữ HPG, có nên giữ không
Trả lời: a 1–2 sentence summary + 3–5 risks with signals + invalidation conditions, neutral tone, no buy/sell recommendation.

**Tránh:** only praising along with the user to confirm their bias; concluding "nên bán" yourself.
