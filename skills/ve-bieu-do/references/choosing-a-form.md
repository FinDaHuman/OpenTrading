# Cây quyết định chọn hình theo shape data

Duyệt từ Q0 xuống. Mỗi nút là 1 câu hỏi yes/no về SHAPE data (không hỏi tên
tool — tool mới sau này trả shape nào thì rơi đúng nhánh đó).
**DỪNG ở node ★ đầu tiên khớp**: lấy danh sách candidates → chọn 1 theo
context câu hỏi user (gợi ý chọn ghi dưới mỗi node ★).
Không khớp nhánh nào → Q8. Thiếu ngưỡng tối thiểu → báo thiếu data,
KHÔNG vẽ chay, KHÔNG bịa số.

Q0. User đã nêu rõ muốn chart gì (nến/line/pie...)?
    CÓ → bỏ qua cây, vẽ thẳng.  |  KHÔNG → Q1.

Q1. Data có deltas CỘNG DỒN theo thứ tự không? (bước trước → bước sau,
    có running total: dòng tiền ròng từng phiên, P&L từng bước, base → shocked)
    CÓ → ★ [waterfall]  (cần start + ≥1 delta; mỗi bước ghi delta + running total)
    KHÔNG → Q2.

Q2. Data có cột TIME liên tục không? (date/datetime/phiên thứ tự. Nhãn năm
rời rạc — vd cổ tức 2022/2023/2024 — tính là CATEGORY, không phải time.)
├─ CÓ → Q3 (nhánh TIME)
└─ KHÔNG → Q4 (nhánh KHÔNG-TIME)

── NHÁNH TIME ──
Q3. Mỗi điểm có đủ O/H/L/C không?
├─ CÓ → ★ [candlestick]  (+volume pane nếu có cột v; times → trục X; cần ≥5 nến)
└─ KHÔNG (chỉ giá trị đơn) → Q3b. Mấy chuỗi số?
    ├─ 1 chuỗi → ★ [line, area, sparkline, sparkcolumn, linebox, winloss]
    │    line: trend chi tiết (mặc định)  |  area: nhấn khối tích lũy dưới đường
    │    sparkline: gọn/nhanh, chuỗi ngắn ≤6 điểm  |  sparkcolumn: dạng cột theo
    │    thứ tự + dirs (vd volume từng phiên)  |  linebox: phong cách ký tự box
    │    winloss: chỉ khi DẤU từng phiên mới là thông điệp (thắng/thua), không
    │    phải trend giá trị (returns ±% theo phiên vẫn là line).
    │    (Ngưỡng chung: ≥2 điểm/phiên.)
    ├─ ≥2 chuỗi CÙNG đơn vị (RSI/PE/PB/%, lợi suất, yields)? → ★ [multiline]
    │    Mỗi series 1 màu + legend. Mỗi series ≥2 điểm, cần ≥2 series.
    │    (Giá nhiều mã tuy cùng đơn vị tiền nhưng magnitude lệch → KHÔNG vào đây.)
    └─ ≥2 chuỗi KHÁC magnitude (giá nhiều mã, mã vs index)? → ★ [chart_compare]
         Chuẩn hóa % từ điểm đầu, mỗi mã 9 dòng + trục Y riêng.
         2–5 chuỗi, mỗi chuỗi ≥2 điểm.

── NHÁNH KHÔNG-TIME ──
Q4. Data có NHÃN NHÓM/category không? (mã, ngành, sự kiện, tháng, outcomes...)
├─ CÓ → Q5.
└─ KHÔNG (số thuần / cấu trúc đặc biệt) → Q6.

Q5. Mỗi nhóm có dạng số gì?
├─ 1 value/nhóm, có ÂM lẫn DƯƠNG? → ★ [bar diverging]
│    (âm trái, dương phải, gốc 0 chung. Vd: % tăng/giảm, dòng tiền ròng,
│    premium/discount, odds ±, thay đổi giá.)
├─ 1 value/nhóm, KHÔNG âm:
│   ├─ Tổng các nhóm ≈100% VÀ ≤7 nhóm? → ★ [pie, bar]
│   │    pie: nhìn tỷ trọng một cái nhìn (thanh 100% + legend);
│   │    bar: cần so chính xác từng %.  (Vd: holders, weights, breadth 4 nhóm,
│   │    rating mix buy/hold/sell. pie cần ≥2 lát, ít nhất 1 lát >0.)
│   ├─ Tổng ≈100% nhưng >7 nhóm? → [bar].  (pie >7 lát không đọc được.)
│   └─ Còn lại (doanh thu, target, odds %, counts, giá snapshot nhiều mã,
│       1 metric của bảng peer)? → [bar].  (1 nhóm duy nhất vẫn vẽ bar 1 cột được.)
├─ Nhóm × THÀNH PHẦN (mỗi nhóm chia nhiều phần)? → ★ [stacked]
│    Mỗi thành phần 1 màu + legend. Vd: mua/bán theo phiên, DT/LN theo quý.
└─ Thắng/thua từng phiên + biên độ (dấu ± là chính)? → ★ [winloss]
     Mỗi phiên 1 dòng ▲+số / ▼−số. Cần ≥2 phiên.

Q6. Data có phải PHÂN PHỐI (nhiều giá trị đo cùng hiện tượng)?
├─ 1 nhóm nhiều giá trị → ★ [histogram]
│    Bins tự động. Cần ≥5 điểm. Vd: CARs các sự kiện, tương quan các cửa sổ,
│    returns 1 mã.
├─ Nhiều nhóm CÙNG magnitude → ★ [boxplot]
│    Mỗi nhóm ≥4 điểm. Vd: lợi suất % nhiều mã, CAR theo nhóm sự kiện.
│    (Khác magnitude → box xẹp: chuẩn hóa % trước, hoặc rẽ sang bar.)
└─ Không phải phân phối → Q7.

Q7. Cấu trúc đặc biệt nào?
├─ 2 biến số (x, y) từng quan sát? → ★ [scatter] (+groups từng mã + legend)
│    Vd: volume↔giá. Ngưỡng ≥3 điểm. Braille cùng cỡ → phân biệt bằng MÀU.
├─ Ma trận 2D thật (hàng×cột đều có labels)? → ★ [heatmap]
│    Vd: ma trận tương quan, param grid fast×slow, tháng×metric.
│    (Hàng đơn + cột đơn thuần túy → về Q5 bar.)
├─ Bid/ask ladder (price+volume mua/bán)? → ★ [chart_depth]
│    ASK đỏ / BID xanh. Sổ rỗng cả 2 bên (ngoài giờ) → báo trung thực.
├─ 1 số + max (index, score /100, % hoàn thành)? → ★ [gauge, donut]
│    gauge: index/ngưỡng (sợ hãi, RSI snapshot...);
│    donut: 1 phần của tổng (thanh 2 segment). Cần value + max.
│    (Score thang khác — vd sentiment −1..1 — chuẩn hóa về max trước.)
├─ Dict nhiều chỉ số KHÁC đơn vị, không vẽ chung được? → text + tùy chọn
│    gauge riêng cho chỉ số đơn lẻ có max (vd RSI trong signals snapshot).
│    (Vd: signals_technical, vs_trading_info, stock_overview.)
├─ Bảng peer (hàng × metric)? → chọn 1 metric → về Q5 [bar].
│    (Vd: peer_compare, compare_equities, financial_ratios.)
└─ 1 giá trị đơn, không trend, không max? → [KHÔNG VẼ — ghi số + text]
     Vd: giá latest, index value.
     (Lịch ngày mà KHÔNG có values — event_calendar, corporate_calendar... —
     luôn text, đừng ép vào nhánh nào.)

Q8. [Bắt mọi trường hợp còn lại — tool mới sau này] Không khớp nhánh nào?
→ Đừng đoán mò: so với node gần nhất theo thứ tự ưu tiên
   (có time → nhánh TIME; có nhãn → Q5; ma trận → heatmap; odds/prob → Q5 bar),
   hoặc KHÔNG VẼ và báo lại shape đã thấy (dạng cột + ví dụ 2-3 dòng đầu)
   để bổ sung cây sau. Không bao giờ bịa data cho vừa chart.
