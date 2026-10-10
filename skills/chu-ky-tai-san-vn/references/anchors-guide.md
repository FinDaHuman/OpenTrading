# Đọc anchors VN (tra `vn_asset_anchors`, luôn ghi nguồn)

Anchors là dữ liệu báo cáo kỳ (không daily) — mỗi dòng có provenance. Cách đọc:
- **deposit/lãi gửi**: E/P thị trường − lãi gửi 12M > 0 → tiền rời gửi sang CK; < 0 kéo dài → tiền về gửi. Mốc lịch sử: tra trong `vn_asset_anchors`, ghi nguồn.
- **govbond yields**: 10Y tăng suốt = reflation + cung lớn; đảo chiều giảm = Reflation trade (mua duration).
- **corpbond wall**: đáo hạn quý hiện tại + 2 quý tới; BĐS > 60% wall hoặc lãi phát hành > 10% = stress hệ thống.
- **gold spread**: SJC premium > 10% = đầu cơ hoặc sắp can thiệp; co về < 3% = bình thường hóa.
- **foreign flows**: bán ròng + USD căng đồng thời = vòng xoáy rút vốn; mua ròng trở lại + nâng hạng = gió đổi chiều.
- Thiếu: margin aggregate không tồn tại công khai — proxy bằng basis + thanh khoản, ghi rõ khi dùng proxy.
