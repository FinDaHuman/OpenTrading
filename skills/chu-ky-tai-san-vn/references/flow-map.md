# Vòng luân chuyển tiền VN (logic, số tra tool)

Tiền rẻ/SBV nới (Reflation) → TPCP (lợi suất giảm) + tiết kiệm thấp
→ tiền rời gửi → CK khi E/P − lãi gửi > 0 (Recovery)
→ CK nóng + USD căng + spread SJC giãn (Overheat: vàng/USD/BĐS)
→ TPDN wall + margin stress + basis đảo premium (phân phối)
→ suy thoái → tiết kiệm/USD/vàng (trú)

Trigger định lượng (verify lại bằng tools mỗi lần dùng):
- USD tăng nóng tháng + khối ngoại bán ròng = giảm tỷ trọng CK (tương quan VNI–USD: tra tool, không dùng số nhớ).
- Spread SJC > 10% = đầu cơ/can thiệp sắp tới (timeline trong anchors).
- Basis discount sâu + thanh khoản lớn = vùng đáy; premium + hưng phấn = cuối sóng.
- BTC tháng mạnh = tín hiệu risk-on sớm cho VNI (kiểm trong `vn_asset_chains`); vàng/USD không dùng để dự báo.
- TPDN BĐS lãi > 10% + wall đáo hạn Q4 = rủi ro hệ thống treo trên BĐS/bank.
