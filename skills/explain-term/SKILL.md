---
name: explain-term
description: "Explains a stock-market term (P/E, EPS, ROE, margin, ATO/ATC, foreign room, T+2) in plain Vietnamese, with a hypothetical example and common traps. Use when asked what X is."
match_text: "Giải thích một thuật ngữ chứng khoán (P/E, EPS, ROE, margin, ATO/ATC, room ngoại, T+2) bằng tiếng Việt đơn giản, ví dụ giả định và bẫy hay gặp. Dùng khi hỏi X là gì."
activation: auto
triggers:
  keywords: [nghĩa là gì, khái niệm, thuật ngữ, giải thích thuật ngữ]
version: 1.3.0
---

# Giải thích thuật ngữ

Answer in exactly 5 steps, lightly, without drifting into ticker analysis or recommendations. Every illustrative number is a round hypothetical — you must label it "ví dụ giả định", never letting the user think it is real.

## Khi nào dùng

- Use when: the user asks what a term, indicator or concept is (P/E, EPS, ROE, margin, ATO/ATC, foreign room, T+2...).
- Do NOT use (use another skill instead): challenging a buy/hold thesis (use `devil-advocate`); analysing a specific ticker (use `phan-tich-chuyen-sau-1-ma`); drawing charts (use `ve-bieu-do`).

## Các bước

**Bước 1–2: Definition + formula.**

A one-sentence definition with no other unexplained jargon. Write the formula in words; never plug in real figures.

**Bước 3: Illustrative example.**

Round hypothetical numbers, labelled "ví dụ giả định".

**Bước 4: Practical use in Vietnam + 1 common trap.**

E.g.: a P/E made artificially low by a one-off profit, a margin call, a closed foreign room.

**Bước 5: End with 1 open question.**

To help the user dig deeper (e.g. "bạn muốn xem P/E này so với ngành không?"). Explain only 1 term per turn.

## Cấu trúc câu trả lời

In this order: one-sentence definition · formula in words · hypothetical example (labelled as such) · use in Vietnam + common trap · 1 open question.

## Ví dụ

**Ví dụ 1:**
Hỏi: P/E là gì
Trả lời: a one-sentence definition + formula in words + a labelled hypothetical example + a Vietnamese trap + 1 open question.

**Tránh:** defining with harder jargon; forgetting "ví dụ giả định" so the user thinks the numbers are real; answering at textbook length.
