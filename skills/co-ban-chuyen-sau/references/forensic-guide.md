# Cẩm nang đọc M-Score + F-score (VN)

Chỉ mở khi chạy leg forensic của `co-ban-chuyen-sau`. Mọi kết luận "sạch/đỏ" phải dẫn từng con số dưới đây, không kết luận chay.

## M-Score (Beneish): 8 biến

| Biến | Ý nghĩa ở VN | Dấu đỏ |
|---|---|---|
| DSRI | Chất lượng doanh thu (phải thu / doanh thu) | > 1.03 nghi kê khớp doanh thu |
| GMI | Biên gộp xấu đi so kỳ trước | > 1 |
| AQI | Chất lượng tài sản (tài sản dở dang, chi phí treo) | > 1 |
| SGI | Tăng trưởng doanh thu (áp lực giữ đà tăng) | càng cao càng dễ bóp số |
| SGAI | Chi phí bán hàng + quản lý / doanh thu | bank thường null do LCTT rỗng (xem ngoại lệ) |
| LVGI | Đòn bẩy (nợ / tài sản) tăng | > 1 |
| TATA | Accruals (lợi nhuận − dòng tiền HĐKD) / tài sản | dương lớn = lãi giấy |

Ngưỡng: **M < −1.78 = ít dấu thao túng; M > −1.78 = nghi ngờ**.

## F-score (Piotroski rút gọn cho skill này): 6 điểm

ROA · CF>ROA (dòng tiền thật hơn lãi sổ) · dROA (ROA cải thiện) · leverage (đòn bẩy giảm) · margin (biên cải thiện) · turnover (vòng quay tài sản). Điểm nào mất thì ghi rõ **vì sao (kỳ nào, dòng BCTC nào)**.

## Ngoại lệ ngân hàng

Bank cho M partial (SGAI null do LCTT rỗng — đã gặp live ở VCB) thì ghi **"M không kết luận"**, không gán M = 0. F-score diễn giải kèm NPL/CASA/LDR thay vì đọc chay.
