---
name: xuat-nhap-khau-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN trade by tariffs by origin/product/destination/date, product mix, FDI drivers and imports as a leading signal. Use for export sectors and trade effects."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích xuất nhập khẩu Việt Nam theo thuế theo xuất xứ/hàng/đích/ngày, cơ cấu ngành hàng, động lực FDI và dòng nhập khẩu làm tín hiệu dẫn. Dùng khi hỏi ngành xuất khẩu và tác động thương mại."
activation: auto
requires_tools: [vs_xnk_detail, vs_indicator_data]
uses_tools: [vs_xnk_detail, vs_indicator_data, financial_detail, financial_ratios, vn_forex_ohlcv, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành xuất nhập khẩu, tác động thuế quan đến xuất khẩu, thuế đối ứng, thuế đối ứng mỹ, thuế xuất khẩu, thuế nhập khẩu, cán cân thương mại, vốn FDI, nhập siêu, tỷ giá xuất khẩu, phân tích xuất khẩu, xuất khẩu tăng, nhập khẩu máy móc]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Xuất nhập khẩu Việt Nam — framework phân tích

Vietnamese trade is **a policy cycle on top of a technology cycle**: annual growth
is one number, but inside it product groups run on different cycles
(electronics rising strongly while textiles move sideways). This skill reads the sector through:

1. **Tariffs by their actual scope** — rates can differ by origin, product code/group,
   destination market and effective date. Base/reciprocal tariffs, anti-dumping,
   countervailing duties, sector measures and exemptions can interact; check the stacking
   rules in the text; never assume the same rate for every partner.
2. **The global technology cycle** — electronics and components have their own cycle, not moving
   with textiles.
3. **Machinery imports as a leading indicator** — equipment imports can signal investment, but projects, progress and published capacity
   are needed to verify; they may only be machine replacement, stockpiling or re-exports.
4. **Foreign capital flows** — foreign-invested firms account for most export
   value; new investment inflows are a leading signal for the next export cycle.

## Khi nào dùng

- Use when: the user asks about exports, imports, what tariffs affect, FDI flows, which groups benefit and which are squeezed.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`; only one ticker's statements → `co-ban-chuyen-sau`.
  - Agricultural/forestry exports (rice, coffee, cashews, wood) are read here — the export
    channel and product groups; the domestic production macro side → `danh-gia-vi-mo-viet-nam`.
  - Detailed Vietnamese macro figures (GDP growth, inflation) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Tariffs by scope | Gaps in applied tariffs by origin, product group and market can shift relative prices; exemptions and effective dates must be checked | Texts from the destination market's trade/customs authority; `news_market`/`web_search` to find official sources, stating the product code, effective date and stacking rules |
| The global technology cycle | The electronics replacement/capacity cycle drives the whole sector's growth, separate from textiles and handicrafts | Growth **by product group**: `news_market`/`web_search` (GSO and General Department of Customs releases by period, citing the source) — `vs_xnk_detail` returns only the by-country breakdown, no product groups |
| Machinery imports (leading indicator) | Equipment/component imports can signal investment or stockpiling; project, progress and order disclosures are needed to confirm; never prove new capacity from the import series alone | **Equipment/machinery imports by product group**: `news_market`/`web_search` (commodity tables by period, citing source + period); cross-check `vs_xnk_detail` for import direction by country |
| Foreign capital flows | Foreign-invested firms account for most export value; new registrations and disbursements decide future output | Registered/disbursed capital: look up the supported indicators before using `vs_indicator_data`, or take the investment authority's releases; state the period and distinguish registered/disbursed |
| Product mix | The same "exports" label, but electronics, textiles, handicrafts, forestry and seafood face different tariffs and different cycles | Product group + value: `news_market`/`web_search` (commodity statistics by period). `vs_xnk_detail` gives only **the by-country breakdown + the FDI sector's share** |
| Exchange rate | A rising USD/VND can lift USD revenue converted to VND, while raising import costs/USD debt. It does not by itself raise USD export value; the profit effect depends on net FX receipts/payments and hedging | `vn_forex_ohlcv` for USD/VND, cross-checked with company notes; the USD index is context and never replaces the bilateral rate |

## Các bước

**Bước 1: Set the scope (in parallel).**

`symbol_lookup` (if asked about one company) · `vn_company` (product segments + export
markets). If asked about the sector → go straight to Bước 2.

**Bước 2: Trade data (in parallel).**

`vs_xnk_detail` (exports/imports by period, **by country** + FDI share) · `vs_indicator_data`
(total exports via the `XK` preset; for FDI, look up the indicator catalogue and supported parameters first, or take the investment authority's releases) · `news_market`/`web_search` for series
**by product group** (equipment, electronics, textiles, seafood) — state the period and product group you are reading.

**Bước 3: Tariff policy + exchange rate (in parallel).**

`news_market` (tariff policy, exemption lists, technical measures, investigations) ·
`vn_forex_ohlcv` (USD/VND); the USD index from published sources if context is needed.

**Bước 4: Cross-read the import–export pair (in parallel).**

Put equipment/component imports next to exports of **the same product group** (both from
`news_market`/`web_search` by period; `vs_xnk_detail` only cross-checks direction by country) ·
policy correlation (`news_market`) · for the ticker: `financial_detail` (export revenue if disclosed) · `peer_compare` only the overview keys it really returns; export mix and operating KPIs from each peer's statements/disclosures for the same period.

## Cây quyết định ngành hàng đang hưởng hay bị siết

Go through the nodes in order; record the intermediate state and move on. Stop only at ★.
Missing data must be stated and lowers confidence; never treat missing data as a negative signal.

Q1. Have tariffs by origin, product code/group, destination market, exemptions and effective date been established?
├─ Yes → record the applied rate and scope → Q2
└─ No → record tariffs unverified; do not assume exemption or equal rates → Q2

Q2. Is the applied rate higher than competitors' for the same product/market?
├─ Higher → record a relative price disadvantage → Q3
├─ Equal/lower → record neutral/relative advantage → Q3
└─ No competitor data → record the tariff advantage unclear → Q3

Q3. How are the product group's orders, prices and volumes?
├─ Improving together → record favourable demand → Q4
├─ Weakening → record demand pressure → Q4
└─ Missing/conflicting → record demand unclear; do not infer from the technology/textile label → Q4

Q4. Are rising equipment/component imports tied to specific projects?
├─ Published progress, capacity and orders → record a cross-checked investment signal → Q5
├─ Only rising imports seen → record a signal needing verification, possibly replacement/stockpiling → Q5
├─ Imports not rising → record no signal from imports; do not infer no new capacity → Q5
└─ No series by product group → record no leading indicator yet → Q5

Q5. What is the company's net FX risk?
├─ Weak VND, net USD receipts after imports/debt/hedging → ★ "Có thể tăng doanh thu quy đổi VND; đánh giá cùng thuế, cầu và tín hiệu đầu tư đã ghi"
├─ Weak VND, net USD payments or large USD debt → ★ "Có thể tăng chi phí nhập/nợ và lỗ tỷ giá; doanh thu USD không tự tăng do tỷ giá"
├─ Strong VND → ★ "Doanh thu USD quy đổi VND có thể giảm, chi phí nhập/nợ USD có thể giảm; kết luận theo vị thế ròng và phòng hộ"
├─ Stable → ★ "Tỷ giá ít biến động; đánh giá chủ yếu từ thuế, cầu và đầu tư đã ghi"
└─ Missing FX structure or exchange-rate data → ★ "Chưa đủ dữ liệu kết luận tác động tỷ giá; giới hạn kết luận ở các kênh đã xác minh"

## Chỉ báo đặc thù ngành

The trade indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Trade is not valued with a common multiple: use **a frame by product group** — technology
goods on P/E expectations of the replacement cycle, handicrafts on seasonal EV/EBITDA and
input costs, agricultural goods on P/E expectations of output prices. Always estimate **the
share of export value exempt from tariffs** before settling growth expectations.
Anchor expectations with `planned_targets` and `analyst_consensus`.

## Rủi ro đặc thù

- **Thematic tariff risk**: exemption lists change with policy rounds; non-exempt
  groups lose price advantage against exempt competitors.
- **Order risk**: small agricultural/seafood exporters are prone to cancelled orders and investigations.
- **Technology-cycle risk**: electronics jump during growth, but also fall sharply
  when the replacement cycle stalls.
- **Exchange-rate risk**: imported raw-material costs and export value move in opposite
  directions on the same balance sheet.
- **Aggregate-misreading risk**: whole-sector growth is one number hiding many product-group
  cycles moving in opposite directions.

## Ranh giới

- Do not determine the market phase or infer "xuất khẩu mạnh nên ngành X sẽ dẫn sóng" →
  `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer tariff rates from memory without looking them up: tariffs are a policy variable; state
  the source and text date.
- Never mix trade totals with expectations for a specific product group.

## Giới hạn

- `vs_xnk_detail` updates monthly through a browser session, with a lag: state the data
  period.
- Export shares/the FDI sector are national totals, not one
  company's share.
- Exemption lists and tariff rates are changing policy: conclusions must state the date of the text
  in force.

## Ví dụ

**Ví dụ 1:**
Hỏi: Xuất khẩu tăng mạnh thì nhóm nào hưởng?
Đạt khi: totals distinguished from product groups, machinery imports of the same group as a leading
indicator, and a verdict following the Q1→Q5 tree stating which product group.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
stacked export value by product group, multiline equipment imports with technology-goods
exports, bar estimated exempt-tariff share. Draw with `chart_render` using `from_call`
(the `[ref …]` code) from tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read the import–export pair as a leading indicator, group products and estimate the exempt-tariff share |
