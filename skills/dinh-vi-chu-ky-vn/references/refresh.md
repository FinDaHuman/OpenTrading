# Tự cập nhật bảng thống kê (refresh procedure)

> Mục đích: giữ các bảng prior trong `references/` không quá cũ, đúng quy ước "số liệu lấy từ tool, bảng chỉ là prior".
> Nguyên tắc đã chốt với user: **đề xuất khi cũ** — skill kiểm tra staleness mỗi lần gọi (Bước 0), user đồng ý mới chạy refresh.

## 1. Khi nào refresh (điều kiện kích hoạt)

Refresh khi MỘT trong các điều kiện đúng:
- (a) `as_of` trong `seasonality-vn.md` quá **90 ngày** so với hôm nay.
- (b) Vừa qua **Tết âm lịch** mà bảng Tết chưa gồm cái Tết đó (Tết ảnh hưởng mạnh T1–T2, cần cập nhật ngay).
- (c) Vừa trải qua **đáy/đỉnh chu kỳ lớn** (drawdown > 20% hoặc đỉnh lịch sử mới) — bảng peaks/troughs và market-history cần thêm dòng.
- (d) User yêu cầu explícit ("cập nhật thống kê", "refresh số liệu chu kỳ").

Khi kích hoạt nhưng user CHƯA đồng ý: chỉ cảnh báo + ghi verdict ở mức tin cậy tối đa "trung bình", không tự ý chạy.

## 2. Hai lớp dữ liệu (kiến trúc refresh)

| Lớp | Nội dung | Cách refresh | Tần suất |
|---|---|---|---|
| **Live** (không lưu) | RS 3M mảng, đỉnh gần nhất, bias tháng hiện tại | Tính trực tiếp từ MCP tools mỗi lần gọi skill (`vn_index_ohlcv` 126 nến, `seasonality`, `event_study`) — luôn mới, không cần refresh | Mỗi lần gọi |
| **Prior dài hạn** (lưu trong references) | Bảng tháng 16y/8y, chuỗi rotation, peaks/troughs, timeline chu kỳ | Tool `cycle_stats_*` dưới đây (incremental, chỉ fetch phần thiếu); xong thì bump `as_of` + `stats_version` (v2→v3…) trong header từng file | Khi điều kiện mục 1 đúng |

## 3. Refresh bằng tool harness `cycle_stats_*` (mặc định, incremental)

Tool định nghĩa tại `src/core/tools/cycle-stats/` (worker `refresh.py` + wrapper TS). Ba tools:

| Tool | Việc | Ghi chú |
|---|---|---|
| `cycle_stats_check` | Đọc watermark cache, trả `days_stale` + `needs_refresh` + coverage | Read-only, gọi ở Bước 0 với `as_of` trong header bảng |
| `cycle_stats_refresh` | Refresh 1 batch mã: fetch `[watermark+1, hôm nay]` + 10 phiên overlap qua VCI; **lệch close > 0.5% → full re-fetch mã đó**; append vào cache `~/.opentrading/cycle_stats/` | Ghi cache riêng, tối đa 15 mã/call — **gọi ~12 mã/call (~10–15s, benchmark 2026-10: ~0.6s/mã)** |
| `cycle_stats_finalize` | Recompute toàn bộ bảng từ cache, trả JSON | Read-only; chép JSON vào 4 file references rồi bump version |

Quy trình chạy (sau khi user đồng ý):
1. `cycle_stats_check(as_of=...)` → xác nhận stale + coverage (lần đầu: cache trống → 0/90).
2. Gọi `cycle_stats_refresh` lặp lại theo batch 12 mã đến hết ~90 mã (VNINDEX, VN30, VNFIN, VNFINLEAD, VNMAT, VNREAL, VNUTI, VNIT, VNSI, HNXINDEX, HNX30 + ~80 mã 15 mảng). Batch nào `failed` → gọi lại batch đó (resumable). Lần đầu chạy full từ 2018 (VNINDEX từ 2011); các lần sau chỉ fetch delta vài chục phiên.
3. `cycle_stats_finalize` (kèm `extra_tet` nếu có Tết mới) → đối chiếu JSON vs bảng cũ: ô nào đổi > 20% thì ghi chú "đảo regime".
4. Chép số mới vào 4 file references + bump `as_of` (ngày chạy) + `stats_version` (v+1). KHÔNG sửa SKILL.md trừ khi workflow đổi.
5. **Tự rà soát & cập nhật định nghĩa** (mục 6 dưới đây — bắt buộc mỗi lần refresh, không cần duyệt riêng vì user đã chốt tự động hoàn toàn; mọi thay đổi ghi vào changelog mục 7).

Quy ước tính toán (khóa, không đổi giữa các lần refresh để số so sánh được):
- Basket equal-weight = mean lợi suất ngày các mã thành viên (daily-rebalanced). **CẤM median** (sai compounding).
- Coverage floor basket ở 2018-10-01 (VCI community trả limit không nhất quán — vài mã vieux lọt data 2017; floor giữ sample ổn định). VNINDEX giữ full history.
- Resample dùng `prod(min_count=1)` để tháng toàn-NaN không thành 0.0 (bug từng làm mean giảm một nửa).
- Hit-rate chỉ tính trên tháng có data (`sum/count_notna`), NaN không tính là giảm.
- Member 15 mảng versioned trong tool (`members_version`); đổi thành viên → tool auto full-fetch mã mới.

## 4. Fallback khi tool harness không chạy được

Nếu môi trường thiếu python3/vnstock/pandas:
1. `vn_index_ohlcv` VNINDEX/VN30/VNFIN/VNREAL/VNUTI/VNMAT count=365 → cập nhật đỉnh/đáy gần nhất trong rotation-chains mục 4 + market-history timeline.
2. `seasonality` cho VNINDEX + VN30 + VNFIN → kiểm tra bias tháng hiện tại còn khớp bảng không; lệch thì ghi chú.
3. `event_study` quanh đỉnh/đáy mới → bổ sung dòng vào market-history.
4. Bump `as_of` + ghi rõ "refresh gọn (index-level), basket chưa recompute" trong header.

## 5. Sau refresh

- Trả lời user: bảng nào đổi, số nào đổi đáng kể (>20%), stats_version mới.
- Quay lại workflow skill bình thường với bảng mới (verdict được lên tin cậy cao nếu đủ bằng chứng).
- Không bao giờ xóa số cũ âm thầm: mọi thay đổi bảng đều qua bump version có ngày.

## 6. Tự rà soát & cập nhật định nghĩa (bắt buộc mỗi lần refresh)

Nguyên tắc user đã chốt: **tự xem lại SKILL.md và toàn bộ references đối chiếu số liệu mới — cứ sai là cập nhật**, không cần duyệt riêng, không ngưỡng dung sai. "Sai" được định nghĩa vận hành như sau, duyệt từng loại:

1. **Mọi con số** trong SKILL.md + 4 references (hit-rate, mean, median, n, ngày đỉnh/đáy, thứ hạng, số năm) phải khớp finalize JSON trong sai số làm tròn (±0.05 sau làm tròn 1–2 chữ số) — lệch là sửa số.
2. **Mọi nhãn định tính** phải khớp số mới:
   - "mạnh nhất/xương sống/dẫn dắt" chỉ giữ nếu vẫn top chuỗi (rel_mean cao nhất nhóm so sánh + hit ≥ 55%);
   - "không tồn tại" chỉ giữ nếu rel_mean ≤ 0;
   - "vừa" = rel dương nhỏ (< +1.5%) hoặc hit 50–55%; "yếu" = hit < 50%.
   - Nhãn nào không còn khớp → viết lại nhãn (kể cả đảo thứ tự gợi ý trong ma trận pha→mảng).
3. **Mọi quy tắc timing** đối chiếu peaks/troughs mới:
   - "VNFIN đỉnh trước VNI 3–6 tháng": kiểm tra chênh lệch 2 chu kỳ gần nhất còn trong khoảng không;
   - "VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng": kiểm tra còn đúng không;
   - "T10 tệ nhất", "T1 mạnh nhất", "pre-Tết thắng ~93%": kiểm tra bảng mới còn giữ không.
   - Quy tắc nào bị dữ liệu mới phủ định → viết lại quy tắc + ví dụ minh họa.
4. **Ma trận pha→mảng** (`phase-playbook.md` mục 2): hit-rate/rel nào đổi thì đổi theo số mới; mảng nào rớt khỏi top thì thay bằng mảng thay thế theo đúng thứ tự số mới.
5. **SKILL.md**: chỉ sửa khi (a) con số trong ví dụ/cấu trúc trả lời lệch số mới, hoặc (b) workflow thật sự gãy (tool đổi tên, bước thừa/thiếu, thứ tự bước sai). Không sửa văn phong, không đổi kiến trúc workflow vì drift số thuần túy.
6. CẤM bịa ngưỡng mới: mọi ngưỡng trong checklist pha (RS +15%, drawdown 20%, breadth 50%...) chỉ đổi khi có bằng chứng định lượng từ ≥2 chu kỳ trong dữ liệu mới — nếu không đủ bằng chứng thì giữ nguyên và ghi chú "chưa đủ dữ liệu kết luận".

## 7. Changelog bắt buộc (audit trail)

Mỗi lần refresh (kể cả kết luận "không có gì sai") ghi một entry vào cuối file này:

```
## Changelog
- [YYYY-MM-DD] stats vX→vY (as_of ...→...): <số bảng đổi>; định nghĩa: <không đổi | liệt kê file:dòng cũ→mới + lý do>. Review bởi quy trình mục 6.
```

Không xóa entry cũ. User kiểm tra sau thay vì duyệt trước — changelog là bằng chứng duy nhất.

## Changelog

- [2026-10-09] stats v1→v2 (as_of 2026-10-02→2026-10-09): data thêm 1 tuần (đến 09/10); T10/2026 partial. Số bảng: drift nhẹ (VD bankRS3m→CK 3.35→3.16/hit 63→62; VNI T1 n=15→16 nhờ VNINDEX sâu tới 2010). Định nghĩa: (1) CK→BĐS weekly +18%→+17%; (2) NH→Dầu khí -0.57%/46%→-0.56%/45%; (3) nhãn CK "Mạnh nhất"→"Hit cao nhất (đồng hạng)" vì steel rel cao hơn (3.78>3.16); (4) nhãn thép "Rất mạnh"→"Vượt trội trung bình cao nhất"; (5) số WTI +29% gắn provenance FRED 09/2026 (tool chưa recompute). Tool: thêm trough_events + leadlag_1w vào finalize; fix 3 bug (prod min_count, hit NaN-as-False, floor 2018-10-01). Review bởi quy trình mục 6.
