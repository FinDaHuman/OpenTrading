# Chỉ báo xuất nhập khẩu — phân nhóm hàng, thuế và tỷ giá

`vs_xnk_detail` gives the by-country breakdown and the FDI share, **not product-group series**.
Total exports come from the `vs_indicator_data` preset `XK`; any other metric needs the catalogue
and supported parameters looked up first. Product groups and FDI come from customs/statistics office/
investment authority releases or reports with a clear origin via `news_market`/`web_search`.
State the period and unit, separate volume from value, and preliminary from official figures.

## Nhóm hàng và đầu tư

| Group/indicator | Source and how to read |
|---|---|
| Electronics, components, equipment | Customs/statistics office commodity statistics; cross-check orders, prices and output. Never assume electronics are tariff-exempt |
| Textiles, footwear, handicrafts | Commodity statistics for the same period; check seasonality and demand. Never assume this group moves sideways or is not exempt |
| Wood furniture | Housing market of the importing country; sector measures and anti-dumping cases |
| Steel, aluminium, cement, fertilisers | Commodity prices; sector duties; the EU carbon border charge |
| Agriculture, forestry, seafood | Output, unit prices, quarantine, quotas and trade measures by group |
| Equipment/machinery imports | Commodity statistics; a rise may come from new investment, replacement or re-exports. Projects and progress are needed to confirm capacity |
| Component/raw-material imports | Commodity statistics; a rise may come from prices, stockpiling or production. Never infer new orders/capacity from rising imports alone |
| Exports of the same group | Compare volume/price with imports by period; correlation proves neither causation nor the same company |
| Registered/disbursed FDI | Investment authority releases or a verified tool metric; separate registered, disbursed and operating capacity |

## Thuế

Build the comparison for the same product and destination market: origin, product code, base/reciprocal tariffs,
anti-dumping/countervailing duties or sector measures, exemptions, effective dates and
stacking rules. Look up the official texts in force at the time of analysis. Never assume
a uniform common rate across partners or a fixed exemption by a technology label. If
unverified, record it as missing; an exempt share needs the value denominator of the right scope; never invent an estimate.

## Tỷ giá và doanh nghiệp

| Indicator | How to read |
|---|---|
| USD/VND | `vn_forex_ohlcv`; a rising USD/VND means a weaker VND. USD revenue converted to VND may rise; it does not by itself raise USD export value |
| Import costs and USD debt | A weaker VND can raise import/debt costs and cause FX losses; profit depends on net receipts/payments, the pricing mechanism and hedging |
| USD index | If sourced, use it only as context; it never replaces USD/VND, and never infer a company's competitiveness from it |
| Export/FX revenue | `financial_detail(statement=TM)` if broken out, or company disclosures; if missing, never infer the share yourself |
| Inventory/receivables | Statements; growing faster than revenue calls for ageing/inventory and seasonality checks; it does not by itself prove orders are piling up |

`peer_compare` uses only the overview keys it really returns; export-market KPIs, imported raw
materials and capacity come from each peer's statements/disclosures for the same period and segment.
