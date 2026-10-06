---
name: tim-kiem-tin-tuc
description: Săn tin theo từ khóa/mã/phạm vi VN-toàn cầu kể cả rumor (săn web + comments, đối chiếu công bố, verdict 4 cột + nhãn CHƯA XÁC NHẬN). Luôn dùng skill này khi user nêu mã/từ khóa cụ thể hoặc muốn xác minh tin đồn — ví dụ "tin về FPT", "nghe đồn HPG, có thật không" — ngay cả khi user không nói rõ muốn "tìm tin".
activation: auto
requires_tools: [mcp__opentrading__news_symbol]
tool_budget: 10
triggers:
  keywords: [tin về, tìm tin, tin tức về, news về, tin trên, dư luận về, nghe đồn, tin đồn, có thật không]
version: 1.2.1
---

# Hunting News Including Rumors

Rumor có trước tin chính thống — săn cả hai nhưng bắt buộc phân loại rõ chính thống vs CHƯA XÁC NHẬN. Không bao giờ suy diễn rumor thành sự thật, không bỏ nhãn độ tin.

## When to Use

- Dùng khi: user nêu mã/từ khóa/phạm vi cụ thể, muốn săn tin + rumor + dư luận, muốn xác minh tin đồn, muốn phân tích chi tiết 1 tin.
- Khi KHÔNG dùng (dùng skill khác thay thế): digest mặc định không từ khóa → `tin-tuc-nong-viet-nam` / `tin-tuc-nong-quoc-te`; chỉ hỏi crowd/FOMO → `phan-tich-sentiment`; chỉ hỏi rating/target CTCK → `tim-co-hoi-bao-cao-ctck`; chỉ hỏi backtest chiến lược → `kiem-chien-luoc-backtest`.

## Workflow

Copy checklist và tick theo tiến độ (chọn ĐÚNG 1 mode):

```
Task Progress:
- [ ] Mode A (theo mã): news_symbol → săn web + comments → đối chiếu → sentiment
- [ ] Mode B (VN): news_market + corporate → 2-3 mã nổi bật
- [ ] Mode C (toàn cầu): news_market gdelt → geo/event + web EN
- [ ] Verdict 4 cột + nhãn xác nhận
```

**Mode A — Theo mã (+ rumor).**

1. Chạy `news_symbol` (symbol, limit=20) trước. CẤM đi web_search trước khi có kết quả `news_symbol` — web chỉ để xác minh chéo sau.
2. Săn web + comments song song: `web_search` ("tên mã" + "đồn"/"tin đồn"/rumor, tối đa 2 query) → `web_fetch` 1–2 URL đáng ngờ nhất + `fireant_thread` (post_id từ bước 1 — rumor nằm ở replies; Fireant posts giờ có id thật, không bịa post_id).
3. Đối chiếu tuần tự: `corporate_calendar` (symbol) + `company_events` (symbol) — tin có khớp công bố không?
4. Dư luận: `sentiment_score` (symbol). Đủ ≥5 tin đạt chuẩn thì dừng.

**Mode B — VN.**

1. Chạy song song `news_market` (limit=15) + `corporate_calendar` (limit=20).
2. Tuần tự: `news_symbol` × 2–3 mã nổi bật + `web_search` tin nóng nhất để xác minh chéo. Không đào thêm mã ngoài 2–3 mã.

**Mode C — Toàn cầu.**

1. Chạy song song `news_market` (sources=gdelt, limit=10).
2. Song song: `geo_intel` (topic) / `event_stats` (query) + `web_search` (từ khóa EN). GDELT rỗng → thử English 1 lần rồi kết luận "ít coverage ngôn ngữ đó".

**Validate chung.**

`web_search` ẩn khi thiếu key → chỉ dùng Fireant+GDELT + ghi rõ "chưa quét web". Cả 2 nguồn news chết → đọc `snapshot_history` (kind=news_feed), bắt buộc ghi rõ "cache <ngày>".

## Template

ALWAYS use this exact verdict structure:

| Tiêu đề | Tuổi tin | Độ tin cậy + provenance | Triển vọng |
- **Tiêu đề** đầy đủ, có mã liên quan. **Tuổi tin** (mấy giờ/ngày trước — tin cũ >3 ngày với bluechip coi như đã phản ánh giá). **Độ tin cậy** (chính thống / CTCK / Fireant-crowd / ẩn danh-nguồn mở) + provenance (`news_symbol`/`news_market`/Fireant/GDELT/web). **Triển vọng** (tác động tới DN: doanh thu/lợi nhuận/giá — hay chỉ là noise). Tin đồn bắt buộc nhãn `CHƯA XÁC NHẬN` + điều kiện xác nhận (chờ công bố nào, ngày nào).
- Phân tích chi tiết tin quan trọng nhất: Ai nói → nói gì → bằng chứng kèm theo → tác động định lượng được không (VD cổ tức bao nhiêu đồng, thương vụ bao nhiêu tỷ) → kịch bản nếu đúng/sai.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Nghe đồn HPG ... thật không
Output: `news_symbol("VCB")` → lãi suất VCB 0.1-6% posts · GDELT "dầu" live · corporate VCB 487 docs · `fireant_thread` (post PNJ 42088453) → root + 2 replies thật → verdict 4 cột + phân tích chi tiết + nhãn xác nhận, ≤10 calls. Thiếu 1 trong 4 cột verdict → chưa đạt; thiếu nhãn `CHƯA XÁC NHẬN` cho rumor → chưa đạt.
