# Refresh bảng global (tool-driven)

1. `g_asset_check()` → run only if stale (>90 days) + the user agrees.
2. `g_asset_refresh()` → incremental fetch of 17 ETFs + USREC + recompute monthly/phase/corr. The outlook (`g_asset_outlook`) is refreshed BY HAND each quarter from banks/funds (always record the quarter + source).
3. Do not edit skill files after a refresh (see `dinh-vi-chu-ky-vn/references/refresh.md` section 6) + the changelog below. Note: the Early/Late/Recession phase table comes from only 1 recession — adding a new recession to USREC is a priority when NBER announces one.

## Changelog

- [2026-10-10] stats v1 (initialised from the 10/2026 research): seeded monthly/phase/corr/outlook. Original definitions per this file.
