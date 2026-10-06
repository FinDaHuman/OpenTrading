---
name: explain-term
description: "Explain securities terms (P/E, EPS, ROE, margin, ATO/ATC, room ngoại, T+2) in simple Vietnamese: 1-sentence definition + formula in words + hypothetical example + common pitfalls. Always use this skill when the user asks what an indicator or concept is — even when the question is only 2-3 words like 'P/E là gì'."
activation: auto
triggers:
  keywords: [là gì, nghĩa là gì, giải thích, khái niệm, thuật ngữ]
version: 1.3.0
---

# Explaining Securities Terms Simply

Answer in exactly 5 steps, keep it lean, never drift into stock analysis or recommendations. All illustrative numbers are rounded hypotheticals — always label them "ví dụ giả định" (hypothetical example), never let the user mistake them for real figures. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks what a term, indicator or concept is (P/E, EPS, ROE, margin, ATO/ATC, room ngoại, T+2...).
- When NOT to use (use another skill instead): countering buy/hold theses (use `devil-advocate`); analyzing a specific stock (use `phan-tich-chuyen-sau-1-ma`); drawing charts (use `ve-bieu-do-ky-thuat`).

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: 1-sentence definition, simple Vietnamese
- [ ] Step 2: formula in words (if any)
- [ ] Step 3: hypothetical example (clearly labeled)
- [ ] Step 4: how it works in VN + 1 common pitfall
- [ ] Step 5: 1 open-ended question
```

**Step 1–2: Definition + formula.**

Definition in one sentence, no other unexplained jargon. Formula written in words, never swap in real numbers.

**Step 3: Illustrative example.**

Rounded hypothetical numbers, always labeled "ví dụ giả định".

**Step 4: Real-world usage in VN + 1 common pitfall.**

Examples: deceptively low P/E from one-off profits, margin call, locked foreign room.

**Step 5: End with 1 open-ended question.**

Helps the user dig deeper (e.g. "bạn muốn xem P/E này so với ngành không?"). Explain only 1 term per turn.

## Template

ALWAYS use this exact output structure: 1-sentence definition · formula in words · hypothetical example (clearly labeled as such) · VN usage + common pitfall · 1 open-ended question.

## Examples

**Example 1:**
Input: P/E là gì
Output: 1-sentence definition + formula in words + clearly-labeled hypothetical example + VN pitfall + 1 open-ended question.

**Anti-pattern (never do this):** defining with harder jargon; forgetting the "ví dụ giả định" label so the user mistakes numbers for real ones; answering like a textbook chapter.
