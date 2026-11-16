# Refresh bảng VN multi-asset (tool-driven)

1. `vn_asset_check()` → run only if stale (>90 days) + the user agrees.
2. `vn_asset_refresh()` → incremental fetch of 6 assets (VCI/yfinance/petrol API) + recompute monthly. Anchors are NOT automatic (periodic reports) — update them by hand each quarter from VBMA/TCBS/the press, keeping the provenance principle.
3. Do not edit skill files after a refresh (see `dinh-vi-chu-ky-vn/references/refresh.md` section 6): if new numbers contradict a rule, say so in the answer.

## Changelog

- [2026-10-10] stats v1 (initialised from the 10/2026 research): seeded monthly/anchors/chains. Original definitions per this file.
