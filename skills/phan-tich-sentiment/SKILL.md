---
name: phan-tich-sentiment
description: Đo dư luận crowd về 1 mã trên Fireant (điểm sentiment + quotes + cảnh báo FOMO). Luôn dùng skill này khi user hỏi phố/crowd nói gì về một mã, sentiment hay FOMO — ví dụ "Phố nói gì về FPT", "crowd có FOMO HPG không" — ngay cả khi user không nói rõ muốn "đo sentiment".
activation: auto
requires_tools: [mcp__opentrading__sentiment_score]
tool_budget: 6
triggers:
  keywords: [sentiment, dư luận, phố nói gì, crowd, fomo, tâm lý nhà đầu tư, comment]
version: 1.1.1
---

# Measuring Single-Stock Crowd Sentiment

Đo *đám đông*, không đo *doanh nghiệp* — crowd có thể sai, sentiment không bao giờ là leg duy nhất của quyết định. Chỉ 1 symbol/run; limit 20 đủ 90% mẫu, không nới limit.

## When to Use

- Dùng khi: hỏi dư luận/crowd/FOMO/comment về 1 mã cụ thể trên Fireant.
- Khi KHÔNG dùng (dùng skill khác thay thế): tin chính thống/rumor → `tim-kiem-tin-tuc`; fear/greed chung → `danh-gia-vi-mo-quoc-te` / `nhip-dap-crypto`; rating CTCK → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: top 20 posts + điểm + comments post nóng nhất (song song)
- [ ] Step 2: đối chiếu công bố (chỉ khi mâu thuẫn)
- [ ] Step 3: verdict (điểm + quotes + comments + FOMO + cảnh báo)
```

**Step 1: Top 20 posts + điểm + comments (song song).**

Chạy `sentiment_score` (symbol, limit=20) — điểm + posts từ Fireant. Chạy `news_symbol`/Fireant posts (limit=20) đọc title/summary top 20. Chọn post nóng nhất (interact/comment cao nhất) → chạy `fireant_thread` (post_id) lấy comments (replies) thực tế — đọc mood comments, không chỉ đọc điểm. Đủ điểm + ≥3 quotes + comments ≥3 + nhãn nguồn thì dừng.

**Step 2: Đối chiếu công bố (chỉ khi mâu thuẫn, tuần tự).**

Chạy `company_events` (symbol) khi comment contradicts disclosures. Không dùng sentiment để "chốt luận" — chỉ confirm/deny.

**Step 3: Validate trước khi chốt.**

Thiếu Groq → `score_heuristic` + warning "groq unavailable" → bắt buộc nhãn `heuristic` trong verdict (heuristic thang khác, không chuẩn hóa chéo 2 mode Groq/heuristic). Posts rỗng = mã ít bàn (empty hợp lệ), không bịa quotes, ghi rõ "ít bàn luận". Fireant chết → fallback duy nhất: GDELT titles qua `tim-kiem-tin-tuc` (1 call), ghi rõ nguồn thay thế. Không diễn giải heuristic thành "nên mua/bán".

## Template

ALWAYS use this exact verdict structure:

- **Điểm sentiment** (Groq hoặc heuristic — bắt buộc ghi nhãn nguồn).
- **3–5 trích comment tiêu biểu** (positive / negative / repeat-thuyết) + provenance Fireant.
- **Nhận diện FOMO/hoảng loạn** (tần suất symbol tag + likes); ngưỡng heuristic: <−0.3 hoảng loạn · >+0.3 FOMO · giữa = trung tính.
- **Cảnh báo vòng lặp bắt buộc:** crowd có thể sai — sentiment không được là leg duy nhất của quyết định.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Phố nói gì về FPT
Output: FPT — 20 posts, heuristic **−0.25**, trong khi M −2.06 sạch (điển hình crowd≠fundamentals) · VCB posts lãi suất 0.1-6% → điểm + ≥3 quotes + nhãn nguồn, ≤4 calls. Thiếu nhãn nguồn hoặc thiếu cảnh báo vòng lặp thì chưa đạt.
