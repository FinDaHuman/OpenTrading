# Đọc corr regimes (tra `g_asset_corr`)

- `regime="full"` (2010→): baseline dài hạn. `pre22` vs `post22`: break cấu trúc 2022.
- Điểm đã verify: SPY–TLT lật âm→dương sau 2022 (bonds mất vai trò hedge); BTC–SPY tăng (ETF-ization); DBC–SPY rớt (commodity idiosyncratic); GLD–UUP seesaw mạnh lên.
- Tương quan BTC–vàng tăng vọt gần đây là đặc điểm của giai đoạn, không phải bản chất (dài hạn thấp; vàng là tài sản trú ẩn tốt hơn, BTC chỉ đa dạng hoá) — đọc số theo regime trong `g_asset_corr`.
- Quy tắc: mọi kết luận corr phải nêu regime; corr full-sample trung bình che giấu break thì ghi rõ.
