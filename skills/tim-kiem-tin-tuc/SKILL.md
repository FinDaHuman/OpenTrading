---
name: tim-kiem-tin-tuc
description: Hunt news by keyword/ticker/scope from VN to global, including rumors (web + comments hunt, cross-check announcements, 4-column verdict + CHƯA XÁC NHẬN label). Always use this skill when the user names a specific ticker/keyword or wants to verify a rumor — e.g. "tin về FPT", "nghe đồn HPG, có thật không" — even when the user doesn't explicitly say they want to "tìm tin".
activation: auto
requires_tools: [mcp__opentrading__news_symbol]
tool_budget: 10
triggers:
  keywords: [tin về, tìm tin, tin tức về, news về, tin trên, dư luận về, nghe đồn, tin đồn, có thật không]
version: 1.3.0
---

# Hunting News Including Rumors

Rumors precede official news — hunt both but always classify clearly official vs CHƯA XÁC NHẬN. Never pass a rumor off as fact; never drop the confidence label.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user names a specific ticker/keyword/scope, wants news + rumor + crowd hunting, wants to verify a rumor, or wants a deep dive on one item.
- When NOT to use (use another skill instead): default digest without keywords → `tin-tuc-nong-viet-nam` / `tin-tuc-nong-quoc-te`; crowd/FOMO only → `phan-tich-sentiment`; broker rating/target only → `tim-co-hoi-bao-cao-ctck`; strategy backtest only → `kiem-chien-luoc-backtest`.

## Workflow

Copy the checklist and tick as you progress (pick EXACTLY 1 mode):

```
Task Progress:
- [ ] Mode A (by ticker): news_symbol → web + comments hunt → cross-check → sentiment
- [ ] Mode B (VN): news_market + corporate → 2-3 standout tickers
- [ ] Mode C (global): news_market gdelt → geo/event + web EN
- [ ] 4-column verdict + confirmation label
```

**Mode A — By ticker (+ rumors).**

1. Run `news_symbol` (symbol, limit=20) first. NEVER run web_search before `news_symbol` returns — the web is only for cross-verification afterwards.
2. Hunt web + comments in parallel: `web_search` ("ticker name" + "đồn"/"tin đồn"/rumor, max 2 queries) → `web_fetch` the 1–2 most suspicious URLs + `fireant_thread` (post_id from step 1 — rumors live in the replies; Fireant posts have real ids now, never fabricate a post_id).
3. Cross-check sequentially: `corporate_calendar` (symbol) + `company_events` (symbol) — does the news match an announcement?
4. Crowd: `sentiment_score` (symbol). Stop once ≥5 items meet the bar.

**Mode B — VN.**

1. Run in parallel `news_market` (limit=15) + `corporate_calendar` (limit=20).
2. Sequentially: `news_symbol` × 2–3 standout tickers + `web_search` the hottest item for cross-verification. Do not dig beyond the 2–3 tickers.

**Mode C — Global.**

1. Run in parallel `news_market` (sources=gdelt, limit=10).
2. In parallel: `geo_intel` (topic) / `event_stats` (query) + `web_search` (English keywords). GDELT empty → try English once, then conclude "ít coverage ngôn ngữ đó".

**Shared validation.**

`web_search` hidden when the key is missing → use Fireant+GDELT only + state "chưa quét web" clearly. If both news sources are dead → read `snapshot_history` (kind=news_feed), must state "cache <ngày>" clearly.

## Template

ALWAYS use this exact verdict structure:

| Tiêu đề | Tuổi tin | Độ tin cậy + provenance | Triển vọng |
- **Tiêu đề** full title, with related tickers. **Tuổi tin** (hours/days ago — news >3 days old on a bluechip counts as already priced in). **Độ tin cậy** (official / broker / Fireant-crowd / anonymous-open-source) + provenance (`news_symbol`/`news_market`/Fireant/GDELT/web). **Triển vọng** (impact on the business: revenue/profit/price — or just noise). Rumors must carry the `CHƯA XÁC NHẬN` label + confirmation conditions (which announcement to await, on which date).
- Deep dive on the most important item: who said it → said what → attached evidence → is the impact quantifiable (e.g. dividend per share, deal size in billions) → scenario if true/false.

## Examples

**Example 1 (live 02-10-2026, do not fabricate new numbers):**
Input: Nghe đồn HPG ... thật không
Output: `news_symbol("VCB")` → VCB interest-rate 0.1-6% posts · GDELT "dầu" live · corporate VCB 487 docs · `fireant_thread` (post PNJ 42088453) → root + 2 real replies → 4-column verdict + detailed analysis + confirmation label, ≤10 calls. Any 1 of the 4 verdict columns missing → not done; missing the `CHƯA XÁC NHẬN` label for a rumor → not done.
