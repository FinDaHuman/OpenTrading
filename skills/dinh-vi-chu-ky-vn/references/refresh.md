# Tự cập nhật bảng thống kê (refresh procedure — PG-backed)

> Mục đích: giữ các bảng prior trong PG (`cycle_*`) không quá cũ.
> Nguyên tắc: **đề xuất khi cũ** — skill kiểm tra staleness mỗi lần gọi (Bước 0), user đồng ý mới chạy refresh. Refresh dùng tool GHI trên server (chạy lâu, mỗi lần hỏi duyệt): tìm bằng `tool_search` khi cần, skill không nạp sẵn.

## 1. Khi nào refresh (điều kiện kích hoạt)

Refresh khi MỘT trong các điều kiện đúng:
- (a) `cycle_stats_check` báo `days_stale` quá **90 ngày**.
- (b) Vừa qua **Tết âm lịch** mà bảng Tết chưa gồm cái Tết đó.
- (c) Vừa trải qua **đáy/đỉnh chu kỳ lớn** (drawdown > 20% hoặc đỉnh lịch sử mới).
- (d) User yêu cầu rõ ràng.

Khi kích hoạt nhưng user CHƯA đồng ý: chỉ cảnh báo + ghi verdict ở mức tin cậy tối đa "trung bình", không tự ý chạy.

## 2. Kiến trúc dữ liệu

| Lớp | Nội dung | Cách refresh |
|---|---|---|
| **Live** (không lưu) | RS 3M mảng, đỉnh gần nhất, bias tháng hiện tại | Tính trực tiếp từ MCP tools mỗi lần gọi (`vn_index_ohlcv` 126 nến, `seasonality`, `event_study`) |
| **Prior dài hạn** (PG `cycle_*`) | month_stats, chains, turning, tet, yearly, trough_events | Tools `cycle_stats_*` dưới đây; version trong `cycle_meta` |

## 3. Quy trình refresh bằng MCP tools (mặc định, incremental)

1. `cycle_stats_check()` → xác nhận stale + coverage. Nếu cảnh báo "cấu hình cũ (members_version=...)" → bảng tính theo danh sách ngành đời trước, phải refresh + finalize trước khi kết luận.
2. `cycle_stats_refresh(symbols=[...12 mã...])` lặp lại cho hết **danh sách mã theo dõi do server quản lý** (members của phiên bản cấu hình hiện tại) — lấy danh sách từ server, không đếm tay, không suy ra số mã từ file này. Batch nào `failed` → gọi lại batch đó (resumable). Lần đầu chạy full từ 2018 (VNINDEX từ 2011); các lần sau chỉ fetch delta. Overlap-validate 10 phiên, lệch >0.5% → tool tự full re-fetch mã đó. `cached_symbols` mà `cycle_stats_check` báo là số mã **đã có trong cache**, không phải số mã cần refresh — cache rỗng thì vẫn phải refresh **toàn bộ** danh sách.
3. `cycle_stats_finalize(extra_tet=[...])` (kèm Tết mới nếu có) → recompute toàn bộ + bump `cycle_meta`.
4. Đối chiếu kết quả vs lần trước: ô nào đổi > 20% thì nêu "đảo regime" trong câu trả lời.

Quy ước tính toán (khóa): basket equal-weight = mean lợi suất ngày (daily-rebalanced), **CẤM median**; coverage floor 2018-10-01; resample `prod(min_count=1)`; hit-rate chỉ tính trên tháng có data; members v2 (15 mảng) versioned trong tool; tham số `basket` nhận tên Việt không dấu.

## 4. Fallback khi MCP tools không sẵn sàng

Dùng `vn_index_ohlcv` + `seasonality` + `event_study` cho đỉnh/đáy và bias gần nhất; ghi rõ "số PG chưa refresh" trong câu trả lời.

## 5. Sau refresh

- Trả lời user: bảng nào đổi, số nào đổi đáng kể (>20%), `as_of` mới (từ `cycle_stats_check`).
- Quay lại workflow skill bình thường với bảng mới.

## 6. Không sửa file skill

Skill chỉ giữ phương pháp; mọi con số luôn tra tool ở lần dùng. Sau refresh **không** sửa SKILL.md hay `references/` (harness không có tool ghi file skill, và file skill không chứa số liệu thị trường — `docs/contracts.md`). Nếu số mới phủ định một quy tắc trong `references/`, nêu rõ điều đó trong câu trả lời để người bảo trì cập nhật.

## Changelog

- [2026-10-09] stats v1→v2 (khởi tạo PG từ cache, as_of 2026-10-09): seed 180.621 dòng/90 mã; định nghĩa: chuyển references sang methodology-only (xóa bảng số, giữ logic), workflow SKILL.md chuyển sang MCP tools; xóa harness cycle_stats_* (TS+py+cache JSON). Review bởi quy trình mục 6.
- [2026-10-11] Bỏ mục tự sửa file skill; tool refresh không còn nạp sẵn; dừng khi bảng chưa có dữ liệu.
- [2026-10-18] members v1→v2 (as_of 2026-10-18, rebuild toàn bộ): danh sách ngành đổi thành 15 mảng/119 mã — tách **Vin** (VIC/VHM/VRE/VPL) khỏi BĐS; gộp viễn thông vào CNTT; bỏ mã chết ITA/POM/SFN; bổ sung 43 mã cho các mảng mỏng (bảo hiểm/xây dựng/thép/hóa chất/điện/thực phẩm/vận tải...). Server thêm: alias tên Việt cho `basket`, cảnh báo `members_version` cũ ở `cycle_stats_check`, 3 cặp chuỗi Vin, cột `vin` trong `cycle_trough_events`. Số mới phủ định vài quy tắc cũ (xem `rotation-chains.md` mục 1/4, `market-history.md` mục 2) — đã cập nhật references theo bảng v2.
- [2026-10-20] Gộp quy tắc dùng Vin về **một luật duy nhất** ở `rotation-chains.md` §1: `rel_mean` > 0 · `rel_hit` ≥ 60% (bậc "vừa" đã có ở `seasonality-vn.md` §1) · `n_up` đủ lớn để tin · điều kiện đầu chuỗi đang đúng; tối đa 1 trong 2 mảng gợi ý. `SKILL.md` Bước 5 và `phase-playbook.md` §2/§4 trỏ về đó thay vì tự đặt ngưỡng (trước đó 3 file dùng 3 ngưỡng khác nhau). Bỏ "Vin mạnh T3/T4/T11" — tháng Vin đọc ở hàng `vin` của `cycle_seasonality`.
- [2026-10-20] Đưa references về lại dạng chỉ-phương-pháp (luật ở `docs/contracts.md` §3): bỏ các **kết quả bảng** mà lần 2026-10-18 chép vào — thứ tự chuỗi theo `rel_mean`, quán quân từng năm và từng đáy, năm + độ trễ đỉnh (2021/2025/2026), danh sách mảng T8/T10, tháng mạnh riêng của từng mảng, số mẫu và header "basket v2"; thay bằng cách tra tool + ngưỡng có sẵn. Sửa thêm: `cycle_yearly` là lợi suất năm **tuyệt đối** (không phải RS), `cycle_turning` bỏ qua năm đang chạy (đỉnh YTD), `cycle_stats_refresh` lấy danh sách mã từ server (không dùng `cached_symbols` làm số mã cần refresh), và thêm mục "Giới hạn của bảng chu kỳ". Quy tắc định tính có ghi "kiểm lại" giữ nguyên.
