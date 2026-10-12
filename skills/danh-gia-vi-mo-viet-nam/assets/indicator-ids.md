# Bảng id chỉ tiêu vĩ mô VN (tra cứu nhanh)

Xác minh lần cuối: 2026-10-12 (khớp SKILL.md). Sai cặp id là rows rỗng — rows rỗng thì tra `vs_categories` trước, không đoán id.

| Chỉ tiêu | category | termType | sub |
|---|---|---|---|
| GDP | 73 | tt3 | — |
| CPI | 15 | tt7 | sub2 |
| Xuất khẩu (XK) | 38 | tt2 | — |

Nguồn tra cứu khi thiếu/nghi: tool `vs_categories`. Chỉ tiêu khác (NK, FDI...) không có trong bảng này → bắt buộc tra tool, không bịa id.
