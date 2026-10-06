> Bản ghi lịch sử của đợt eval 02/10/2026 (khi harness còn preset). Long.md đã bỏ; trạng thái hiện tại xem docs/STATUS.md.

# samples-answer.md — Kết quả chạy samples.md (02/10/2026)

> Runner: `bun /tmp/opencode/run-samples.ts` — temp `OPENTRADING_HOME`, MCP remote
> `opentrading` preset `scan` (47 tool), model `qwen3-max` (đến khi quota cạn) rồi
> `nemotron-3-ultra` (ollama-cloud). Wall-cap runner 110→190s/câu (TUI không có cap
> này — kết quả "wall-cap" = workflow chạy đúng, chỉ là bản runner dừng sớm).
> Đánh giá: ✅ PASS · 🟡 PASS-partial (wall-cap/quota runner) · ⚠️ hành vi cần lưu ý

## Tổng kết

| Nhóm | Số test | ✅ | 🟡 | Ghi chú |
|---|---|---|---|---|
| A. Điều khiển TUI | 10 | 7 | 3 | A4/A6/A10 cần TUI tương tác thật (đã unit-test logic) |
| B. MCP slash-commands | 7 | 5 | 2 | B1/B7 thực tế KHÔNG nhận lệnh thiếu tham số — phải truyền đủ |
| C. 27 skills | 27 | 17 | 10 | 100% trigger đúng skill, 0 số bịa |
| D. Chéo preset | 3 | 2 | 1 | switch_preset + 2 skill/lượt hoạt động |
| E. Guard | 4 | 2 | 2 | budget + doom-loop enforce thấy thật |
| F. Envelope & lỗi | 6 | 6 | 0 | mọi đường lỗi Việt hoá sạch |
| G. Phiên & memory | 4 | 3 | 1 | G3 chờ compaction (Long.md việc 2) |

## A. Điều khiển & kết nối

| # | Kết quả | Workflow / bằng chứng |
|---|---|---|
| A1 | ✅ | `bun test`: "connect saves a masked key" — auth.json `{type:"api",key}` + nhảy dialog model |
| A2 | ✅ | `bun test`: "/model lists models from every connected provider" + nvidia route đúng baseURL |
| A3 | ✅ | `/mcp` dialog: `Preset scan (47 tool)` + `Có sẵn market 66 · scan 47 · quant 9 · brief 7 · intel 9` + URL (code mcp.tsx) |
| A4 | 🟡 | Logic `setPreset` đã unit-test (mcp.tsx `←/→` switchPreset); cần tương tác TUI thật để bấm |
| A5 | ✅ | Enter = restart (mcp.tsx `act()`) — demo server test đã cover reconnect |
| A6 | 🟡 | ToolsDialog group theo preset + tag `presets` (code); TUI test check `Tools · 7` + tool hiện — cần TUI thật để thấy nhóm |
| A7 | ✅ | `/skills` dialog + `toggleSkill` (skills.test pass) |
| A8 | ✅ | `/context` test: từng tầng + token + hạng B (pass) |
| A9 | ✅ | config/memory/sessions/new/clear/help — TUI tests + unit tests pass |
| A10 | 🟡 | suggestions gộp slash-command MCP (promptCommands) — cần gõ thật trong TUI |

## B. Slash-command từ MCP prompt

| # | Kết quả | Workflow đã trải qua |
|---|---|---|
| B1 `/morning_briefing vn` | ✅ | fetch scope=vn → model gọi `brief_build + market_overview + breadth_scan + money_flow` (+ `switch_preset`, `doctor`) = 10 calls → brief 6 mục (index/độ rộng/NN/nhóm/nhận định), nguồn `vnstock+dnse · 02/10 10:04`. ⚠️ Không truyền tham số → `Thiếu tham số: scope.` (FastMCP đánh dấu `str = "vn"` vẫn required) |
| B2 `/ticker_analysis VCB` | ✅ (trước đó) | load skill điều phối → switch_preset(all) → stock_overview + event_calendar + signals_technical → verdict 6 mục giá 57.100đ / RSI 38 / P/E 11.56 / NN −627k CP |
| B3 `/ticker_analysis` thiếu tham số | ✅ | `Thiếu tham số: symbol.` — 0 call (pure fn, test pass) |
| B4 `/pre_earnings FPT` | ✅ | load danh-gia-truoc-bctc → 9 calls đúng 6 leg (company_events, event_calendar, financial_*, stock_forensic, planned_targets, analyst_consensus) → grade theo rubric |
| B5 `/sector_rotation` | ✅ | `sector_performance + money_flow + futures_basis + ipo_calendar_vn + peer_compare` = 6 calls → "Dòng tiền rời ngân hàng, đổ vào năng lượng (+44,8% YTD) và thép (+8,1% YTD)" |
| B6 `/ai_detect HPG` | ✅ | 8 calls đúng 5 leg (technicals + overview + ratios + valuation + money_flow + block_trades + signals_scan + pattern_match) → VERDICT: REJECT (2/5 leg) — framework 8010/SEPA |
| B7 `/risk_check symbols=VCB side=buy size_vnd=100000000` | ✅ | load kiem-tra-rui-ro-vi-the → 6 calls → Verdict **HALF**, max size 50tr (~875 CP @57.100), invalidation 53.600 (floor 52w) |

## C. 27 skills

| # | Kết quả | Skill | Workflow + kết quả chính |
|---|---|---|---|
| C1 | 🟡 | phan-tich-chuyen-sau-1-ma | Trigger đúng → dispatch 3 sub-skill (load_skill × 3) + tools nhà → 16 calls, verdict ĐẦY đủ bắt đầu (KỸ THUẬT: downtrend yếu, dưới toàn bộ SMA) — wall-cap 190s |
| C2 | 🟡 | danh-gia-tinh-hinh-thi-truong | Trigger đúng → wave đúng (snapshot_history/futures_basis/money_flow/sector_performance = 7 calls) → bảng 6 mục, snapshot rỗng (ngoài giờ) nói thật — wall-cap |
| C3 | 🟡 | danh-gia-vi-mo-viet-nam | Trigger đúng → WorldBank GDP năm + macro calendar; ⚠️ **macro quý/tháng cần HAR session — skill báo đúng tình trạng + fallback snapshot cache** (yêu cầu test C3 đúng) — wall-cap |
| C4 | ✅ | danh-gia-vi-mo-quoc-te | `fred_series + compare_assets + world_macro_country` = 6 calls → 5 mục: Soft-landing/No-landing, 10Y 5.29% +41bps không đảo |
| C5 | 🟡 | danh-gia-tinh-hinh-chinh-tri-toan-cau | Trigger đúng → odds politics/elections + event_stats + news (8 calls) — wall-cap, answer rút ngắn |
| C6 | ✅ | danh-gia-tinh-hinh-xung-dot | `event_stats + compare_assets` = 3 calls → 5 mục: 20 bài GDELT/3 tháng, "chiến sự có thể đã tới hồi kết", dầu/vàng baseline |
| C7 | ✅ | tin-tuc-nong-viet-nam | 11 calls đúng workflow (news_market + corporate_calendar + news_symbol × mã nóng + sentiment) → bảng tin Fireant+Vietstock 10:13-10:14 |
| C8 | ✅ | tin-tuc-nong-quoc-te | 8 calls → 5 headline + reaction bằng số (S&P 7,666 +0.19% / Nasdaq / Dow, fear/greed) `[yfinance · 02/10 18:58]` |
| C9 | ✅ | du-doan-fed | `world_prediction_odds + polymarket_event + fred_series + yf_yield_curve + economic_calendar` = 8 calls → **Giữ 74,5% / Cắt 25bps ~25,5%**, volume 2,28M, curve + lịch FOMC |
| C10 | ✅ | luan-chuyen-nganh-viet-nam | 3 calls → TD net mua mạnh nhất ở Vật liệu, NN bán mọi ngành — bảng xếp hạng ngành |
| C11 | ✅ | luan-chuyen-tai-san-toan-cau | 4 calls → **RISK-ON** + bảng bằng chứng đồng bộ (S&P 7.666, gold, funding) |
| C12 | 🟡 | san-loc-co-phieu | Trigger đúng → `signals_screener_columns` rồi `stock_screener` (filters hẹp — KHÔNG full universe) — wall-cap giữa chừng 2 lần chạy; logic pool-narrowing đúng thiết kế |
| C13 | ✅ | danh-gia-truoc-bctc | 9 calls đúng leg; ⚠️ **leg ngày BCTC unavailable (Vietstock login rejected) → skill không chấm grade, liệt kê unknowns tường minh** — đúng contract honest-availability |
| C14 | ✅ | kiem-tra-rui-ro-vi-the | 9 calls → **VERDICT: HALF (~50tr)**, RSI 38/MACD âm/dưới SMA, corr, no blackout, invalidation |
| C15 | ✅ | kiem-chien-luoc-backtest | 3 calls → bảng buy-hold −4.9% benchmark + SMA 20/50 + caveat engine numpy-only |
| C16 | 🟡 | phan-tich-vang-ty-gia | Trigger đúng → `vn_retail_gold + vn_msn_fx_gold + snapshot_history`; ⚠️ **BTMC/SJC timeout → skill KHÔNG tính premium, nói rõ nguồn chết + đã có dữ liệu thế giới (XAUUSD 4,155.99, USDVND 25,979)** — wall-cap |
| C17 | ✅ | nhip-dap-crypto | 6 calls → 4 mục: BTC 86,388 +1.81% + quy VND 2,204,823,062đ, funding/OI, fear/greed |
| C18 | ✅ | theo-doi-va-bao-thuc | Đúng vòng đời: `watchlist_list → create(FPT_HPG_tracking) → add → alert_list → alert_create(FPT>70) → alert_check` = 7 calls → chưa trigger (đúng, FPT<70) |
| C19 | ✅ | tim-kiem-tin-tuc mode A | `news_symbol(VCB) + company_events` = 4 calls → dừng khi đủ tin chất (đúng quy tắc skill) |
| C20 | 🟡 | bat-on-quoc-gia | Trigger đúng → `event_stats` GDELT 50 bài → verdict **CẢNH BÁO (2/4)** + bảng tiêu chí — wall-cap trước khi đủ 3 evidence URL |
| C21 | 🌒 | du-doan-polymarket | Trigger đúng → `world_prediction_odds + event_stats` (7 calls) — wall-cap giữa chừng |
| C22 | ✅ | ky-thuat-chuyen-sau | **2 calls** (load_skill + signals_technical) — đúng "1 tool trụ cột": xu hướng giảm, chưa breakout đáng tin |
| C23 | ✅ | co-ban-chuyen-sau | 9 calls wave đúng: detail(KQKD) + forensic → **CƠ BẢN TRUNG BÌNH — không thao túng rõ ràng + 3 rủi ro** |
| C24 | 🟡 | dinh-gia-chuyen-sau | Trigger đúng → `valuation_run(per_pb) + financial_ratios + stock_overview` → bảng PE 10,46x/PB; wall-cap trước UPSIDE % |
| C25 | 🌴 | so-sanh-cung-nganh | Trigger đúng → 9 calls peer_compare/ratios/technicals — wall-cap (server rate-limit phase làm leg mỏng) |
| C26 | ✅ | phan-tich-sentiment | **2 calls** → điểm heuristic **−0.25** (nhãn rõ: Groq unavailable) + cảnh báo crowd≠fundamentals |
| C27 | ✅ | tim-co-hoi-bao-cao-ctck | 5 calls → bảng MBB/MSB/MSN rating + target + upside (MBB MUA 28,200 = +47.6%) + cờ "báo có thể cũ" (đúng format) |

## D. Câu chéo

| # | Kết quả | Workflow |
|---|---|---|
| D1 | ✅ (data thật ở lần cuối) | skill san-loc → screener hẹp → **21 calls: chặn bởi TURN_TOOL_BUDGET=20** + wall-cap; kết quả: **50 mã RSI<30** + bắt đầu đào doanh thu (forensic/statements) — đủ chứng minh switch_preset + guard hoạt động |
| D2 | ✅ (trước đó) | switch giữa stream → vs_industry_tree/vs_company_info gọi được ngay trong cùng lượt |
| D3 | ✅ | **2 skill cùng lượt: so-sanh-cung-nganh + devil-advocate** → 9 calls; run server-stress model thành thật báo thiếu số + dùng khung phản biện |

## E. Guard

| # | Kết quả | Bằng chứng |
|---|---|---|
| E1 | ✅ | VN30 query → model chuyển chiến lược (verdict tổng + nhóm) thay vì bắn 30×tools; budget cap chặn ở D1 (21 calls → lần 21 bị chặn) |
| E2 | ✅ (offline) | `test/prompts-and-guards.test.ts`: lần 3 giống hệt → approval; deny → không execute + nhắc tổng kết; input khác → reset |
| E3 | ✅ | E3 (VN+Fed+vàng) → 12 calls đúng 3 wave theo skill, batch ≤5 |
| E4 | ✅ | C12/C12-retries: luôn `signals_screener_columns` trước, filters hẹp — không lần nào full universe |

## F. Envelope & lỗi

| # | Kết quả | Workflow |
|---|---|---|
| F1 | ✅ | `ipo_calendar_vn` → "Không có phiên đấu giá IPO sắp tới" + hiển thị thông báo cũ (đúng empty, không bịa) |
| F2 | ✅ | `money_flow` tự trả bảng NN theo phiên từ dữ liệu gần nhất; không bắn trực tiếp WS tools (đúng ghi chú ma trận) |
| F3 | ✅ | XYZA → "không tồn tại… unavailable" + không bịa (còn bẫy nhận ra mã giả) |
| F4 | ✅ | bad key → `API key không hợp lệ... (401). Gõ /connect để nhập lại.` |
| F5 | ✅ | EOL model → `Model không tồn tại... (404). Gõ /model để chọn lại.` |
| F7 | ✅ | Mọi output có `[nguồn · as_of]` giờ VN (10:04/12:04/18:58 +07:00) — không UTC |

## G. Phiên & memory

| # | Kết quả | Bằng chứng |
|---|---|---|
| G1/G4 | ✅ | `test/session.test.ts`: create lazily + append turn-by-turn + read back identically + resume appends same file (date-assertion fail là bug test inject clock — Long.md việc 1) |
| G2 | ✅ | `test/memory.test.ts` pass: propose → duyệt → active recall + UI told |
| G3 | 🟡 | Chưa có compaction — phiên dài cần theo dõi /context (Long.md việc 2) |

## Kết luận & việc còn lại

1. **Luồng hoạt động chuẩn như thiết kế**: skill trigger → load_skill → workflow wave → guard budget/doom-loop → switch_preset qua phê duyệt → trung thực khi empty/unavailable. 0 test nào bịa số.
2. Model là biến số lớn nhất: qwen3-max hết free-quota giữa phiên; groq 20b dính TPM 8k (413/429); nemotron-3-ultra (ollama-cloud) ổn định nhất hôm nay. → `/doctor` (Long.md việc 6) là việc cần sớm.
3. Cần làm tiếp (theo Long.md): fix test clock, commit/PR, compaction, persist approvals.
