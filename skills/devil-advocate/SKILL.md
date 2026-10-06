---
name: devil-advocate
description: "Counter investment theses to fight confirmation bias: summarize the thesis, give 3-5 reasons it could be WRONG with tracking signs and falsification conditions. Always use this skill when the user asks about a stock they hold or like, asks for a buy/hold opinion, or requests a counter-argument/bear case — e.g. 'đang giữ HPG có nên giữ không', 'bear case cho VCB là gì' — even when the user doesn't explicitly say they want a 'phản biện' (counter-argument)."
activation: auto
triggers:
  keywords: [phản biện, bear case, có nên giữ, rủi ro gì, đang nắm, đang giữ]
version: 1.3.0
---

# Countering Investment Bias

When users ask about a stock they bought or like, assume confirmation bias — the job is to counter the thesis, not to mock it or conclude on their behalf. Neutral tone, no sarcasm. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user says they hold a stock, asks whether to keep holding, asks what the risks are, asks for a bear case, or requests a counter-argument on a buy/hold thesis.
- When NOT to use (use another skill instead): term definitions (use `explain-term`); charts/candles (use `ve-bieu-do-ky-thuat`); exchange/session/margin mechanics (use `vn-market-basics`).

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: summarize the thesis (confirm correct understanding)
- [ ] Step 2: 3-5 reasons it could be WRONG + tracking signs
- [ ] Step 3: falsification conditions
```

**Step 1: Summarize the thesis in 1–2 sentences.**

Confirm correct understanding before countering; never distort the thesis to make it easier to attack.

**Step 2: List the 3–5 strongest reasons the thesis could be WRONG.**

Cover 5 angles: industry, company, valuation, macro, liquidity. Each reason gets 1 concrete sign to track (which indicator/event shows the risk materializing) — a counter-argument without a tracking sign is vague and useless.

**Step 3: State falsification conditions.**

Which event, if it happens, means the thesis should be dropped. Never conclude buy/sell on the user's behalf.

## Template

ALWAYS use this exact output structure: summarized thesis (1–2 sentences) · 3–5 risks + a tracking sign for each · falsification conditions (when to drop the thesis).

## Examples

**Example 1:**
Input: đang giữ HPG, có nên giữ không
Output: 1–2 sentence summary + 3–5 risks each with a tracking sign + falsification conditions, neutral tone, no buy/sell recommendation.

**Anti-pattern (never do this):** only praising along with the user to confirm the bias; concluding "nên bán" on your own.
