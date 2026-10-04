---
name: phan-tich-sentiment
description: Dư luận/crowd sentiment về 1 mã trên Fireant — điểm + quotes + cảnh báo FOMO, bắt buộc ghi nhãn nguồn.
when_to_use: "Phố nói gì về FPT, sentiment VCB, crowd có FOMO HPG không. Không dùng khi: tin chính thống (tim-kiem-tin-tuc), fear/greed thị trường chung (danh-gia-vi-mo-quoc-te / nhip-dap-crypto)."
activation: auto
requires_tools: [mcp__opentrading__sentiment_score]
tool_budget: 6
triggers:
  keywords: [sentiment, dư luận, phố nói gì, crowd, fomo, tâm lý nhà đầu tư, comment]
version: 1.0.0
---

# Phân tích sentiment

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1 | `news_symbol`(symbol, limit=20) · `sentiment_score`(symbol, limit=20) | song song — cùng nguồn Fireant |
| 2 (chọn khi mâu) | `company_events`(symbol) | đối chiếu cmt với công bố chính thức |

## Verdict

Điểm sentiment (Groq hoặc heuristic — **BẮT BUỘC ghi nhãn nguồn**, heuristic thang khác) +
3-5 trích comment tiêu biểu (positive/negative/repeat-thuyết) + nhận diện FOMO/hoảng loạn
(tần suất symbol tag + likes) + **cảnh báo vòng lặp**: crowd có thể sai — sentiment KHÔNG
được là leg duy nhất của quyết định.

## Chống tràn lan

- 1 symbol/run; limit 20 đủ 90% mẫu — không call lại limit lớn hơn.
- `company_events` chỉ khi comment contradicts disclosures; không dùng sentiment "chốt luận" — chỉ confirm/deny.

## Lỗi thường gặp

Thiếu Groq → `score_heuristic` + warning "groq unavailable" → nhãn "heuristic" trong
verdict. Posts rỗng = mã ít bàn (empty hợp lệ). Fireant chết → fallback duy nhất: GDELT
titles qua tim-kiem-tin-tuc (1 call).

## Bằng chứng live (02-10-2026)

FPT — 20 posts, heuristic **−0.25**, trong khi M −2.06 sạch (điển hình crowd≠fundamentals) ·
VCB posts lãi suất 0.1-6% · Groq key có trên prod, thiếu trên local dev.

## Nghiệm thu

"Phố nói gì về FPT" → điểm + ≥3 quotes + nhãn nguồn, ≤4 calls.

## Ghi chú review — dữ liệu CÓ ý nghĩa nếu đọc đúng

Sentiment đo *đám đông*, không đo *doanh nghiệp* (live: FPT heuristic −0.25 trong khi
M −2.06 sạch). Ngưỡng diễn giải heuristic: <−0.3 hoảng loạn · >+0.3 FOMO · giữa = trung
tính; KHÔNG chuẩn hóa chéo 2 mode Groq/heuristic; không bao giờ dùng sentiment làm leg
duy nhất của quyết định.
