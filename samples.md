# samples.md — Bộ câu hỏi test toàn diện OpenTrading (02/10/2026)

> Chạy: `bun run dev` (TUI) hoặc `bun src/core/chat.ts "<câu>"` (headless).
> Kỳ vọng chung: mọi số liệu phải kèm `[nguồn · as_of giờ VN]`; skill trigger đúng;
> không vượt budget; `empty/unavailable` được nói trung thực.

## A. Điều khiển & kết nối (không cần model trả lời hay)

| # | Hành động | Kỳ vọng |
|---|---|---|
| A1 | `/connect` → chọn Groq/NVIDIA/Alibaba → nhập key | key lưu `~/.opentrading/auth.json` (600), nhảy `/model` |
| A2 | `/model` → gõ lọc → chọn | StatusBar đổi; model chết → lỗi Việt hoá có hướng dẫn |
| A3 | `/mcp` | hiện `Preset scan (47 tool đang gửi model)` + đếm 6 preset + URL |
| A4 | `/mcp` → chọn server → `←/→` | đổi preset tức thì, không reconnect; tool count đổi |
| A5 | `/mcp` → Enter (kết nối lại) | trạng thái ● đã kết nối |
| A6 | `/tools` | nhóm theo preset (market→scan→…), tag `presets`, ◇ = chỉ đọc |
| A7 | `/skills` | 30 skill, mark ●/○ |
| A8 | `/context` | từng tầng + số token + hạng A/B/C |
| A9 | `/config`, `/memory`, `/sessions`, `/new`, `/clear`, `/help` | mở dialog / hành động đúng |
| A10 | `tab` hoàn thành `/tic` → `/ticker_analysis ` | gợi ý lọc đúng cả slash-command của MCP |

## B. Slash-command từ MCP prompt (6 workflows)

| # | Lệnh | Kỳ vọng |
|---|---|---|
| B1 | `/morning_briefing` | fetch prompt → model gọi `brief_build` + `market_overview` + `breadth_scan` → brief đầu phiên |
| B2 | `/ticker_analysis VCB` | đã verify 02/10: load skill điều phối → switch preset nếu cần → verdict 6 mục |
| B3 | `/ticker_analysis` (thiếu tham số) | lỗi `Thiếu tham số: symbol.` không tốn call |
| B4 | `/pre_earnings FPT` | 6 leg + grade A/B/C |
| B5 | `/sector_rotation` | tên rotation + ≥6 con số |
| B6 | `/ai_detect HPG` | heuristic + tùy chọn flags (ghi nhãn nguồn) |
| B7 | `/risk_check VCB` | trả theo framework risk_check (groq backend) |

## C. 27 skills — 1 câu mẫu mỗi skill

| # | Câu hỏi | Skill mong đợi | Kỳ vọng chính (budget) |
|---|---|---|---|
| C1 | "Phân tích toàn diện FPT" | phan-tich-chuyen-sau-1-ma | điều phối sub-skill, ≤6 call nhà, verdict 6 mục |
| C2 | "Thị trường hôm nay sao rồi?" | danh-gia-tinh-hinh-thi-truong | 6 mục, ≥4 mục có số, ≤10 calls |
| C3 | "Đánh giá vĩ mô VN: CPI GDP lãi suất" | danh-gia-vi-mo-viet-nam | 6 mục + quý gần nhất; thiếu session → nói thật |
| C4 | "Kinh tế Mỹ hiện tại thế nào" | danh-gia-vi-mo-quoc-te | 5 mục + curve + fred |
| C5 | "Địa chính trị tuần này có gì đáng lo" | danh-gia-tinh-hinh-chinh-tri-toan-cau | ≥4 mục có prob_pct |
| C6 | "Trung Đông căng thẳng ảnh hưởng dầu vàng gì" | danh-gia-tinh-hinh-xung-dot | 5 mục + số dầu/vàng |
| C7 | "Tin chứng khoán hôm nay" | tin-tuc-nong-viet-nam | ≥5 headline + provenance |
| C8 | "Tin thế giới hôm nay" | tin-tuc-nong-quoc-te | ≥5 headline + ≥2 reaction định lượng |
| C9 | "Fed tháng tới cắt hay giữ" | du-doan-fed | prob ≥2 kịch bản + lịch FOMC + hàm ý VN |
| C10 | "Ngành nào đang hút tiền ở VN" | luan-chuyen-nganh-viet-nam | tên rotation + ≥6 số, ≤10 calls |
| C11 | "Phân bổ tài sản toàn cầu đang risk-on hay risk-off" | luan-chuyen-tai-san-toan-cau | bảng xếp hạng + 3 asset path |
| C12 | "Tìm mã RSI < 30, PE < 20 ngành ngân hàng" | san-loc-co-phieu | ≤10 mã + lý do; filters hẹp (không full universe) |
| C13 | "FPT sắp ra báo cáo, đánh giá setup" | danh-gia-truoc-bctc | grade + 6 leg + unknowns |
| C14 | "Mua 100 triệu VCB được không" | kiem-tra-rui-ro-vi-the | GO/HALF/NO-GO + size + invalidation |
| C15 | "Backtest SMA 20/50 trên HPG 1 năm" | kiem-chien-luoc-backtest | baseline + best/worst param + caveat |
| C16 | "Vàng SJC đắt hơn thế giới bao nhiêu" | phan-tich-vang-ty-gia | premium % + giả định + 2 driver |
| C17 | "Crypto sao rồi, funding thế nào" | nhip-dap-crypto | 4 mục; funding rỗng không chết batch |
| C18 | "Theo dõi FPT và HPG, báo khi FPT > 70" | theo-doi-va-bao-thuc | tạo watchlist + alert + `alert_check` chạy luôn (nhớ cleanup sau test) |
| C19 | "Tin về VCB gần đây" | tim-kiem-tin-tuc (mode A) | ≥3 tin có provenance, dừng khi đủ 5 tin chất |
| C20 | "Thái Lan đang bất ổn gì" | bat-on-quoc-gia | 4 mức verdict + ≥3 evidence URL, ≤6 calls |
| C21 | "Polymarket đang nóng gì về kinh tế" | du-doan-polymarket | ≥5 event + cờ liquidity/end-date |
| C22 | "FPT kỹ thuật sao, có breakout không" | ky-thuat-chuyen-sau | 1-3 calls, `signals_technical` trụ cột (đã verify: 1 call) |
| C23 | "Đọc BCTC FPT, có dấu hiệu thao túng không" | co-ban-chuyen-sau | M-Score + F-score + 4 quý (wave 1 = 2 calls) |
| C24 | "FPT đắt chưa" | dinh-gia-chuyen-sau | UPSIDE % + so lịch sử, ≤7 calls |
| C25 | "VCB vs BID vs CTG, ngân hàng nào tốt nhất" | so-sanh-cung-nganh | bảng ≥3 mã + 1 dòng luận chọn, ≤8 calls |
| C26 | "Phố nói gì về FPT" | phan-tich-sentiment | điểm + nhãn heuristic/groq + ≥3 quotes |
| C27 | "CTCK khuyên mua gì tuần này" | tim-co-hoi-bao-cao-ctck | bảng ≥5 dòng có upside %, kiểm chứng 2 mã top |

## D. Câu hỏi chéo (switch_preset + phê duyệt)

| # | Câu hỏi | Kỳ vọng |
|---|---|---|
| D1 | "Tìm cổ phiếu RSI < 30 và doanh thu đã tạo đáy 1-2 quý trước" | skill san-loc + **switch_preset(market)** khi cần vs_*; hộp phê duyệt (TUI) / allow (headless) |
| D2 | "FPT so với cùng ngành: PE PB ROE biên tăng trưởng" | skill so-sanh-cung-nganh; có thể switch preset để tra ngành — **đã verify: switch giữa stream hoạt động** |
| D3 | "So sánh FPT với CMG và phản biện giúp mình" | nhiều skill/lượt: so-sanh + devil-advocate cùng lượt |
| D4 | Sau khi switch preset: hỏi tiếp "vẽ giá VCB 20 phiên" | preset giữ nguyên phiên, tool mới dùng được ngay |

## E. Guard & chống tràn lan

| # | Câu hỏi | Kỳ vọng |
|---|---|---|
| E1 | "Phân tích toàn bộ VN30 từng mã một" | chặn ở 20 calls/lượt (`TURN_TOOL_BUDGET`) → nhắc tổng kết, không treo |
| E2 | Gây lặp: hỏi lại cùng tool 3 lần (vd screener timeout 2 lần rồi thử lần 3) | hộp phê duyệt doom-loop; từ chối → model tổng kết bằng dữ liệu có |
| E3 | Sóng call: "thị trường + Fed + vàng cùng lúc" | batch ≤5/wave; ≤4 vs_*; ≤3 yf_* |
| E4 | "Tìm mã PE thấp" không kèm filters | screener KHÔNG chạy full 1522 mã — pool-narrowing theo skill S12 |

## F. Envelope contract & lỗi

| # | Câu hỏi | Kỳ vọng |
|---|---|---|
| F1 | "Danh sách IPO sắp tới có gì" | `empty` hợp lệ → "không có", không bịa |
| F2 | "Dòng tiền DNSE realtime" (không worker) | `unavailable` + warnings → dùng fallback tool được gợi ý, 1 lần |
| F3 | "Giá mã XYZ- KHÔNG TỒN TẠI" | không bịa; báo không tìm được mã |
| F4 | API key sai → chat | lỗi 401 Việt hoá + hướng dẫn /connect |
| F5 | Model EOL (vd llama-3.3-70b-versatile) | 404 + hướng dẫn /model (đã gặp: Groq retire model) |
| F6 | Render ngủ đông → hỏi ngay sau 30 phút idle | cold start được báo, không treo vô hạn (startupTimeoutMs) |
| F7 | Timestamp trong kết quả | mọi mốc thời gian đọc theo giờ VN (Asia/Ho_Chi_Minh), không UTC |

## G. Phiên & memory

| # | Hành động | Kỳ vọng |
|---|---|---|
| G1 | Hỏi xong thoát, `bun run dev --continue` | mở lại phiên mới nhất, history + tool lines đúng |
| G2 | `/memory` → duyệt propose | memory bật đúng; recall hiện "Dùng N memory" |
| G3 | Phiên dài (10+ lượt) | chưa có compaction → theo dõi token /context (việc số 2 trong Long.md) |
| G4 | `/sessions` → resume phiên cũ | transcript + lịch sử đúng, không tool-call mồ côi |

## Hàm lượngGold chuẩn (Definition of Done của từng test)

- Đủ số mục verdict như ghi trong từng skill (skills/*/SKILL.md §Nghiệm thu).
- Mọi số có provenance; không có số "phỏng đoán" — lắc đầu khi thiếu dữ liệu.
- Calls trong budget; song song ≤5; 0 call ngoài home list skill.
- Hộp phê duyệt chỉ xuất hiện khi đáng hỏi (preset-switch / doom-loop), không phiền các tool đọc thường.
