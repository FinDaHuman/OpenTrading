---
name: vn-market-basics
description: "Explain Vietnam stock trading mechanics (HOSE/HNX/UPCoM exchanges, ATO/continuous/ATC sessions, price bands, tick size, lots, T+2 settlement cycle, LO/MP order types). Always use this skill when the user asks about trading rules/mechanics — e.g. 'biên độ HOSE bao nhiêu', 'lô chẵn lô lẻ là sao' — even when the user doesn't explicitly say they want to 'hỏi cơ chế'."
activation: auto
triggers:
  keywords: [biên độ, bước giá, lô chẵn, lô lẻ, ATO, ATC, loại lệnh, thanh toán T, phiên giao dịch]
version: 1.3.0
---

# Explaining Vietnam Market Mechanics

Answer concisely per exchange (where they differ) + a note that KRX/CCP/upgrade info may be outdated + 1 line advising to check official sources. Never give current price or market-index numbers in this skill.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks about HOSE/HNX/UPCoM, ATO/continuous/ATC sessions, price bands, tick size, even/odd lots, settlement cycle, order types (LO, MP, ATO, ATC...).
- When NOT to use (use another skill instead): asking what P/E, EPS, ROE, margin mean (use `explain-term` only); asking whether to keep a held ticker (use `devil-advocate` only); asking for current prices/indices (use an analysis skill instead).

## Workflow

Copy the checklist and tick as you progress:

```
Task Progress:
- [ ] Step 1: identify the relevant exchange (split HOSE/HNX/UPCoM)
- [ ] Step 2: answer per current KRX rules + note possibly outdated
- [ ] Step 3: advise checking official sources
```

**Step 1: Identify the relevant exchange.**

Distinguish HOSE/HNX/UPCoM clearly where rules differ; do not collapse price bands/tick sizes/lot sizes of all 3 exchanges into one number.

**Step 2: Answer per current KRX rules.**

Rules change over time (KRX system, CCP roadmap, FTSE upgrade) — must state clearly that the info reflects the model's knowledge and may be outdated. Claiming certainty about new rules without this note is wrong.

**Step 3: Advise checking official sources.**

Always advise the user to cross-check exchange or broker announcements. Do not include current prices — mechanics only, no market numbers.

## Template

ALWAYS use this exact output structure: concise answer per exchange (where they differ) · note that KRX/CCP/upgrade info may be outdated · 1 line advising to check official sources.

## Examples

**Example 1:**
Input: Biên độ HOSE bao nhiêu
Output: number per exchange + note KRX may be outdated + line advising to check the exchange/broker, no market prices.
