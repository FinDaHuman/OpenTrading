---
name: vn-market-basics
description: "Explains VN trading mechanics: HOSE/HNX/UPCoM, ATO/ATC sessions, price bands, tick sizes, lots, T+2, order types. Use for trading rules."
match_text: "Giải thích cơ chế giao dịch VN: sàn HOSE/HNX/UPCoM, phiên ATO/ATC, biên độ, bước giá, lô, T+2, loại lệnh. Dùng khi hỏi quy định giao dịch."
activation: auto
triggers:
  keywords: [biên độ, bước giá, lô chẵn, lô lẻ, ATO, ATC, loại lệnh, thanh toán T, phiên giao dịch]
version: 1.3.0
---

# Cơ chế giao dịch Việt Nam

Answer briefly per exchange (when they differ) + a note that KRX/CCP/upgrade details may be outdated + one line advising the user to check the official source. Never give current prices or market index figures in this skill.

## Khi nào dùng

- Use when: the user asks about HOSE/HNX/UPCoM, ATO/continuous/ATC sessions, price bands, tick sizes, round/odd lots, the settlement cycle, order types (LO, MP, ATO, ATC...).
- Do NOT use (use another skill instead): what P/E, EPS, ROE, margin mean (use `explain-term` only); whether to keep a ticker they hold (use `devil-advocate` only); current prices/indices (use an analysis skill).

## Các bước

**Bước 1: Identify the exchange concerned.**

Separate HOSE/HNX/UPCoM clearly when the rules differ; never merge the three exchanges' bands/ticks/lots into one number.

**Bước 2: Answer by the current KRX rules.**

Rules change over time (the KRX system, the CCP roadmap, the FTSE upgrade) — you must say the information is the model's understanding and may be outdated. Stating new rules with certainty without this note is wrong.

**Bước 3: Advise checking the official source.**

You must advise the user to check the exchange's or their brokerage's notices. Do not add current prices — mechanics only, no market figures.

## Cấu trúc câu trả lời

In this order: a short answer per exchange (if they differ) · a note that KRX/CCP/upgrade details may be outdated · one line advising a check against the official source.

## Ví dụ

**Ví dụ 1:**
Hỏi: Biên độ HOSE bao nhiêu
Trả lời: the figure per exchange + a note that KRX details may be outdated + a line advising a check with the exchange/brokerage, no market prices.
