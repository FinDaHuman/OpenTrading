# Tự cập nhật bảng thống kê (refresh procedure — PG-backed)

> Mục đích: giữ các bảng prior trong PG (`cycle_*`) không quá cũ.
> Nguyên tắc đã chốt với user: **đề xuất khi cũ** — skill kiểm tra staleness mỗi lần gọi (Bước 0), user đồng ý mới chạy refresh. Tự rà soát định nghĩa sau mỗi refresh (mục 6).

## 1. Khi nào refresh (điều kiện kích hoạt)

Refresh khi MỘT trong các điều kiện đúng:
- (a) `cycle_stats_check` báo `days_stale` quá **90 ngày**.
- (b) Vừa qua **Tết âm lịch** mà bảng Tết chưa gồm cái Tết đó.
- (c) Vừa trải qua **đáy/đỉnh chu kỳ lớn** (drawdown > 20% hoặc đỉnh lịch sử mới).
- (d) User yêu cầu explícit.

Khi kích hoạt nhưng user CHƯA đồng ý: chỉ cảnh báo + ghi verdict ở mức tin cậy tối đa "trung bình", không tự ý chạy.

## 2. Kiến trúc dữ liệu

| Lớp | Nội dung | Cách refresh |
|---|---|---|
| **Live** (không lưu) | RS 3M mảng, đỉnh gần nhất, bias tháng hiện tại | Tính trực tiếp từ MCP tools mỗi lần gọi (`vn_index_ohlcv` 126 nến, `seasonality`, `event_study`) |
| **Prior dài hạn** (PG `cycle_*`) | month_stats, chains, turning, tet, yearly, trough_events | Tools `cycle_stats_*` dưới đây; version trong `cycle_meta` |

## 3. Quy trình refresh bằng MCP tools (mặc định, incremental)

1. `cycle_stats_check()` → xác nhận stale + coverage.
2. `cycle_stats_refresh(symbols=[...12 mã...])` lặp lại đến hết ~90 mã. Batch nào `failed` → gọi lại batch đó (resumable). Lần đầu chạy full từ 2018 (VNINDEX từ 2011); các lần sau chỉ fetch delta. Overlap-validate 10 phiên, lệch >0.5% → tool tự full re-fetch mã đó.
3. `cycle_stats_finalize(extra_tet=[...])` (kèm Tết mới nếu có) → recompute toàn bộ + bump `cycle_meta`.
4. Đối chiếu kết quả vs lần trước: ô nào đổi > 20% thì ghi chú "đảo regime" vào changelog.
5. **Tự rà soát & cập nhật định nghĩa** (mục 6) + ghi changelog (mục 7).

Quy ước tính toán (khóa): basket equal-weight = mean lợi suất ngày (daily-rebalanced), **CẤM median**; coverage floor 2018-10-01; resample `prod(min_count=1)`; hit-rate chỉ tính trên tháng có data; members v1 versioned trong tool.

## 4. Fallback khi MCP tools không sẵn sàng

Dùng `vn_index_ohlcv` + `seasonality` + `event_study` cho đỉnh/đáy và bias gần nhất; ghi rõ "số PG chưa refresh" trong câu trả lời.

## 5. Sau refresh

- Trả lời user: bảng nào đổi, số nào đổi đáng kể (>20%), stats_version mới.
- Quay lại workflow skill bình thường với bảng mới.

## 6. Tự rà soát & cập nhật định nghĩa (bắt buộc mỗi lần refresh)

Nguyên tắc user đã chốt: **tự xem lại SKILL.md và toàn bộ references đối chiếu số liệu mới — cứ sai là cập nhật**, không cần duyệt riêng, không ngưỡng dung sai:
1. **Mọi con số** phải khớp tool output trong sai số làm tròn — lệch là sửa (kể cả ví dụ minh họa).
2. **Mọi nhãn định tính** phải khớp số mới (top chuỗi, ngưỡng hit/rel) — nhãn nào không còn khớp thì viết lại.
3. **Mọi quy tắc timing** kiểm lại 2 chu kỳ gần nhất — quy tắc nào bị phủ định thì viết lại.
4. **Ma trận pha→mảng**: hit-rate nào đổi thì đổi theo, kể cả đảo thứ tự gợi ý.
5. **SKILL.md**: chỉ sửa khi con số trong đó lệch số mới, hoặc workflow thật sự gãy. Không sửa văn phong.
6. CẤM bịa ngưỡng mới: mọi ngưỡng trong checklist chỉ đổi khi có bằng chứng định lượng từ ≥2 chu kỳ.

## 7. Changelog bắt buộc (audit trail)

Mỗi lần refresh ghi một entry vào cuối file này:

```
## Changelog
- [YYYY-MM-DD] stats vX→vY (as_of ...→...): <bảng đổi>; định nghĩa: <không đổi | liệt kê file:dòng cũ→mới + lý do>. Review bởi quy trình mục 6.
```

Không xóa entry cũ.

## Changelog

- [2026-10-09] stats v1→v2 (khởi tạo PG từ cache, as_of 2026-10-09): seed 180.621 dòng/90 mã; định nghĩa: chuyển references sang methodology-only (xóa bảng số, giữ logic), workflow SKILL.md chuyển sang MCP tools; xóa harness cycle_stats_* (TS+py+cache JSON). Review bởi quy trình mục 6.
