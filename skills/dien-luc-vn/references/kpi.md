# Chỉ báo ngành điện — nhóm nguồn và cách đọc

> This file keeps **the source grouping** and how to read each indicator, not any
> period's numbers. Every value comes from the latest `financial_detail` / `news_market`, with the period
> stated. Two rules live only in SKILL.md and are NOT repeated here: the single-buyer
> mechanism and electricity prices (§Trụ cột driver) + the rule of comparing only within the same source group
> (§Ranh giới). The "Compare with" column below is how to apply it, not a copy of the rule.

## 1. Phân nhóm nguồn

| Group | Cycle it tracks | Its own season/pattern | Compare with |
|---|---|---|---|
| Hydropower | Water levels and flow (hydrology) | The dry season cuts output, for several periods | The same hydropower group |
| Thermal (coal) | Electricity prices + dispatch share + coal prices | When hydropower drops, thermal runs as backup → its share rises | The same thermal group |
| Gas / LNG | Electricity prices + imported gas costs + the exchange rate | The most FX- and import-sensitive of the thermal groups | The same gas group |
| Wind / solar | The price regime of each project + curtailment + wind/sun | Seasonal resource; curtailment when the grid is full | The same renewable group |
| Transmission / equipment | Grid investment spending, plans | Follows the public-investment cycle, not the dry season | The same equipment group |

## 2. Nhóm dòng thu và công nợ

| Indicator | Read from | How to read |
|---|---|---|
| Revenue | `financial_detail` | Read with output: is revenue up from prices or volume |
| Receivables from the power buyer | `financial_detail` | **Where the sector's main risk sits**: growing faster than revenue signals checking collection quality; it does not by itself prove retail prices are the cause |
| Receivable days | Computed with `shell`: average receivables / quarterly revenue × 90; label it "tính từ" | Compare 4–8 quarters |
| Gross margin | `financial_detail` | Read by source group; the consolidated margin hides gaps between hydro/gas/thermal |
| Financial costs | `financial_detail` | BOT projects with large borrowings: fixed interest costs before operation |
| Depreciation, dividends paid | `financial_detail` (`LCTT`) | A plant past its depreciation shows higher accounting profit: check before comparing P/E |

## 3. Nhóm sản lượng

| Indicator | Read from | How to read |
|---|---|---|
| Period output | `news_market` (sector/company releases) | Read with the source mix: falling output may come from scarce sources, not falling demand |
| Dispatch share | `news_market` | Read with variable costs, grid/technical constraints and contracts; the reserve margin alone does not decide dispatch order |
| Capacity utilisation | `news_market` | A new plant not yet covering fixed costs |

## 4. Nhóm đối chiếu bên ngoài

| Source | What to read | How to use it |
|---|---|---|
| `news_market` | Generation mix by period, reservoir levels, price frameworks and adjustments, project progress | Sector figures; state the source and period |
| `yf_commodities` | Reference natural gas; thermal coal/LNG from sector releases via `web_search` — do not assume the default COMMO set has them | Thermal/gas input costs — reference prices, not contract prices |
| `company_events` | Project events, new power purchase agreements | Confirming future revenue |
| `planned_targets` | Output/revenue/profit plans | Expectation anchor and cross-check against results |

## 5. Bẫy đọc thường gặp

- Power demand rising but one plant's profit falling: check electricity prices and receivables before
  concluding "quản trị kém".
- Comparing the hydro group with the thermal group in the same period: two different cycles; the conclusion will be
  backwards.
- Revenue up from a one-off price compensation: mark it as one-off; never extrapolate.
