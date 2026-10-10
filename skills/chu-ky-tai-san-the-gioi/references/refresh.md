# Refresh bảng global (tool-driven)

1. `g_asset_check()` → stale (>90 ngày) + user đồng ý mới chạy.
2. `g_asset_refresh()` → fetch incremental 17 ETFs + USREC + recompute monthly/phase/corr. Outlook (`g_asset_outlook`) refresh THỦ CÔNG theo quý từ banks/funds (luôn ghi quarter + nguồn).
3. Không sửa file skill sau refresh (xem `dinh-vi-chu-ky-vn/references/refresh.md` mục 6) + changelog dưới đây. Lưu ý: bảng phase Early/Late/Recession chỉ từ 1 suy thoái — thêm suy thoái mới vào USREC là ưu tiên khi NBER công bố.

## Changelog

- [2026-10-10] stats v1 (khởi tạo từ research 10/2026): seed monthly/phase/corr/outlook. Định nghĩa gốc theo file này.
