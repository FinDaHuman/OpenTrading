# Bảng mã chỉ số toàn cầu (tra cứu nhanh)

Xác minh lần cuối: 2026-10-13 (test live qua `vn_global_index`). Dùng đúng mã nguồn vnstock;
mã Yahoo (`^GSPC`, `^IXIC`...) KHÔNG chạy ở đây. Mã nào không có trong bảng → dùng
`yf_global_indices` (Yahoo) thay vì đoán mã khác.

| Chỉ số | Mã vnstock | Mã Yahoo tương ứng |
|---|---|---|
| S&P 500 | INX (SPX/GSPC/SP500/^GSPC đều được) | ^GSPC |
| Dow Jones | USA30 (DJI/DJIA/Dow đều được) | ^DJI |
| Nasdaq Composite | COMP (IXIC/^IXIC/NASDAQ đều được) | ^IXIC |
| Russell 2000 | RUT | ^RUT |
| NYSE Composite | NYA | ^NYA |
| Russell 1000 / 3000 | RUI / RUA | ^RUI / ^RUA |
| FTSE 100 | UKX (FTSE/FTSE100 đều được) | ^FTSE |
| DAX | DAX | ^GDAXI |
| CAC 40 | PX1 (CAC/CAC40 đều được) | ^FCHI |
| Nikkei 225 | N225 (Nikkei đều được) | ^N225 |
| Shanghai SE | 000001 (SHCOMP/SSEC đều được) | 000001.SS |
| Hang Seng | HSI (HangSeng đều được) | ^HSI |
| S&P BSE Sensex | SENSEX | ^BSESN |
| VN-Index | VNI (VNINDEX đều được) | — (không có trên Yahoo) |

Lưu ý: Nasdaq-100 (NDX) KHÔNG có trong nguồn vnstock — cần NDX thì dùng `yf_global_indices`.
