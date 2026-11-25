# Chỉ báo bảo hiểm — phân khúc, công thức và cơ sở

Take the insurer's statements/notes for the same period, after looking up `vs_financial_norms(btype=5)`.
Call `financial_detail` separately for each `statement=KQKD`, `CDKT`, `TM`; metrics not
in the result must come from sourced insurer/association disclosures; never assume the tool returns them.
State the accounting standard, unit, period, gross or net of reinsurance, and the formula.

## Nhân thọ

| KPI | How to read |
|---|---|
| New premiums, APE, renewal premiums | Compare only under the same APE definition and period; total premium revenue does not replace new premiums |
| New vs total premiums | Total premiums rising while new premiums fall = the old book is still collecting, the new source is weak |
| Persistency | Number/value of policies in force / the original cohort for the exact month 13/25/... and the insurer's disclosure; never infer it from premium revenue |
| Acquisition costs | Commissions and distribution costs for the matching premium set; never compare loosely with total premiums |
| Reserves/liabilities and solvency margin | Read the interest-rate and lapse assumptions and the legal scope; rising reserves are not by themselves good quality |

## Phi nhân thọ

| KPI | Formula and conditions |
|---|---|
| Earned premiums | Premiums written in the period − the increase in the unearned premium reserve, per the report's definition; separate direct, assumed and ceded premiums |
| Premiums by line | Motor, health, property–engineering, marine, from notes or company disclosures: which line drives growth and which one drives claims |
| Loss ratio | Incurred claims (paid + change in claim reserves) / earned premiums on the same gross or net basis; never use cash paid in place of incurred |
| Expense ratio | Allocated acquisition and underwriting admin costs / earned premiums on the same basis; if the insurer uses written premiums, say so and never add it directly to a ratio on a different basis |
| Combined ratio | Loss ratio + expense ratio when they share a denominator and scope. Below 100% usually shows an underwriting profit before investment, not consolidated net profit |
| Reserve development | Compare prior years' loss estimates with this period's update; reserve releases can create one-off profit |

## Tái bảo hiểm và đầu tư (cả hai mảng)

| KPI | Formula and use |
|---|---|
| Cession ratio | Ceded premiums / direct plus assumed premiums of the same scope (or the insurer's published basis); state the denominator |
| Retention ratio | Premiums after cession / premiums before cession, same period; never mix earned with written premiums |
| Claim recoveries | Receivables/recoveries from reinsurers, their ageing and counterparty quality; separate gross and net |
| Investment yield | Annualised recurring investment income of the period / average opening/closing investment assets of the same period; standalone quarter ×4, YTD n months ×12/n, TTM not multiplied. Separate gains/losses on disposals and revaluations, and state whether they are in the numerator |
| Duration mismatch | Asset duration, liquidity and currency versus insurance liabilities; never infer from a single yield |

Separate each segment's revenue, costs and profit on the same basis; never create profit weights
when total profit is near zero or negative. Never subtract investment income from consolidated profit to infer
underwriting profit. A mix needs segment weights and consolidation eliminations before comparison.

`peer_compare` uses only the overview keys it really returns, such as P/B/ROE; `metrics` does not create
new premiums, persistency or the combined ratio. Compare the specific KPIs with each peer's data for the same period.
