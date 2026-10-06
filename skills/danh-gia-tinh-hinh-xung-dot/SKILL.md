---
name: danh-gia-tinh-hinh-xung-dot
description: Assess 1 armed conflict (intensity, whether oil/gold prices have priced it in, transmission channels, escalation probability). Always use this skill when the user asks about a specific conflict/combat and its impact on markets — e.g. "Trung Đông leo thang, dầu lên không", "Biển Đông căng thẳng ảnh hưởng gì" — even when the user doesn't explicitly say they want a "đánh giá xung đột".
activation: auto
requires_tools: [mcp__opentrading__event_stats]
tool_budget: 9
triggers:
  keywords: [xung đột, chiến tranh, biển đông, trung đông, leo thang, dầu hay vàng lên, chiến sự]
version: 1.2.0
---

# Assessing Armed-Conflict Market Impact

Answer 5 fixed items: intensity → whether the price has priced it in → transmission channel → escalation probability → position implication. No direct buy/sell recommendations. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user names 1 specific conflict/combat + asks about intensity, escalation, whether the price has priced it in, transmission channel, position implication.
- When NOT to use (use another skill instead):
  - Broad politics/elections → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Single-country unrest (protests/coup, not yet combat) → use `bat-on-quoc-gia`.
  - Just want pure odds → use `du-doan-polymarket`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: measure intensity (GDELT, parallel)
- [ ] Step 2: check whether the price has priced it in (oil/gold, parallel)
- [ ] Step 2b: military aircraft frequency near the conflict zone (geo_intel military=true)
- [ ] Step 3: escalation odds + verification (only if needed)
- [ ] Step 4: 5-item verdict
```

**Step 1: Measure intensity (mandatory, parallel).**

Run `geo_intel` (conflict topic) + `event_stats` (query) at the same time. Try keywords in both Vietnamese and English; GDELT being empty for Vietnamese is a data characteristic (record "VN query empty, used EN query X", retry EN at most 1 time), not an error.

**Step 2: Check whether the price has priced it in (parallel, sequential after Step 1).**

Run `yf_commodities` (oil + gold) + `assets_rotation`. If the latest session is missing, use the most recent session available + state the date clearly; never fabricate current prices. Step 1 counts + Step 2 oil/gold prices are enough for a basic verdict.

**Step 2b: Military aircraft frequency (oracle 8010 reference, 1 call).**

Run `geo_intel` with `military=true` — returns live military aircraft from adsb.lol (count, by_country, by_type), distance to the nearest conflict zone (km) and signal-loss diff (aircraft disappearing near the zone = suspected transponder shutdown, an OSINT signal). Read it as: high count + many tankers/recon near the zone → activity buildup; many "Unknown" operators → official tracking lost. If the tool is dead (adsb.lol 429/geo-block), record honestly; never fabricate aircraft counts.

**Step 3: Escalation odds + verification (only if needed).**

Run `world_prediction_odds` (war keywords) + `web_search`/`web_fetch` (1-2 sources only). If there is no market for the war, record "no odds available"; don't substitute a personal take.

**Step 4: Validate before locking.**

Only 1 topic/call; at most 2 keyword attempts ("biển đông" → "south china sea") then accept "thin coverage". Don't expand to multiple wars within 1 run (if the user asks broadly, suggest splitting per conflict).

## Template

ALWAYS use this exact verdict structure:

1. **Intensity:** GDELT event counts trend (unit counts + up/down trend) + URL.
2. **Priced in yet:** oil/gold move vs baseline (unit USD/barrel, USD/oz, % move) + URL.
3. **Transmission channel:** energy → inflation → rates, 1–2 lines + URL.
4. **Escalation probability:** odds prob_pct (unit %) + end-date + event URL.
5. **Position implication:** cushion/size (references leg 6 of `danh-gia-truoc-bctc`), NO direct buy/sell recommendation.

## Examples

**Example 1 (live 02-10-2026, don't fabricate new numbers):**
Input: Xung đột ảnh hưởng dầu/vàng
Output: `geo_intel("Vietnam")` returns articles · `event_stats("vietnam")` articles >0 · gold 4,195 USD/oz same session → verdict covers all 5 items, with latest-session oil/gold numbers.
