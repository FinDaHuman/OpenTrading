# Refresh bảng VN multi-asset (tool-driven)

1. `vn_asset_check()` → stale (>90 ngày) + user đồng ý mới chạy.
2. `vn_asset_refresh()` → fetch incremental 6 assets (VCI/yfinance/petrol-API) + recompute monthly. Anchors KHÔNG auto (báo cáo kỳ) — cập nhật thủ công mỗi quý từ VBMA/TCBS/báo chí, giữ nguyên tắc provenance.
3. Tự rà soát định nghĩa như skill luân chuyển ngành (cứ sai là cập nhật) + changelog dưới đây.

## Changelog

- [2026-10-10] stats v1 (khởi tạo từ research 10/2026): seed monthly/anchors/chains. Định nghĩa gốc theo file này.
