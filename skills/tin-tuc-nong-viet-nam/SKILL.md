---
name: tin-tuc-nong-viet-nam
description: Digest tin nóng VN trong ngày (5-7 headline + phân loại + sentiment + provenance). Luôn dùng skill này khi user hỏi chung về tin chứng khoán/thị trường/doanh nghiệp VN hôm nay — ví dụ "tin nóng hôm nay", "có tin gì về VN30" — ngay cả khi user không nói rõ muốn "digest tin nóng".
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 9
triggers:
  keywords: [tin nóng, tin chứng khoán, tin hôm nay, tin vn, tin doanh nghiệp, headline]
version: 1.1.0
---

# Digesting Daily Vietnam News

Digest nhanh tin VN trong ngày — headline + phân loại + sentiment, có provenance rõ ràng. Không suy diễn sentiment heuristic thành khuyến nghị mua/bán.

## When to Use

- Dùng khi: hỏi tin nóng VN hôm nay, VN30, thị trường/doanh nghiệp VN, cần 5–7 headline nhanh.
- Khi KHÔNG dùng (dùng skill khác thay thế): có mã/từ khóa cụ thể hoặc rumor → `tim-kiem-tin-tuc`; tin Mỹ/Trung/toàn cầu → `tin-tuc-nong-quoc-te`; đào sâu crowd/FOMO 1 mã → `phan-tich-sentiment`; rating/target CTCK → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: tin chung + lịch công bố (song song)
- [ ] Step 2: đào 2-3 mã xuất hiện nhiều nhất
- [ ] Step 3: sentiment + đối chiếu mã nóng nhất
- [ ] Step 4: verdict 5-7 headline
```

**Step 1: Tin chung + lịch công bố (song song).**

Chạy `news_market` (limit=15) + `corporate_calendar` (limit=20).

**Step 2: Đào mã nổi bật (tuần tự sau Step 1).**

Chạy `news_symbol` × 2–3 mã xuất hiện nhiều nhất trong tin — chọn theo tần suất xuất hiện, không theo cảm tính, tối đa 3 mã.

**Step 3: Sentiment + đối chiếu (song song).**

Chạy `sentiment_score` (mã nóng nhất) + `company_events` (mã đó, chỉ để đối chiếu, không đào toàn bộ lịch sử). Thiếu Groq → dùng heuristic + warning, bắt buộc nhãn `heuristic` trong verdict.

**Step 4: Validate trước khi chốt.**

Fireant chết → tự GDELT fallback trong tool, không retry Fireant vô hạn. Cả hai chết → đọc `snapshot_history` (kind=news_feed) cache 1 ngày, bắt buộc ghi rõ là cache + ngày cache. Feed rỗng cuối tuần/nghỉ lễ → empty hợp lệ, ghi rõ "phiên nghỉ, ít tin mới". Đủ 5 headline có provenance thì dừng; đủ verdict Step 3 cho mã nóng nhất thì dừng. Không call lại `sentiment_score` với limit lớn hơn.

## Template

ALWAYS use this exact verdict structure, mỗi headline gồm: **tiêu đề + mã liên quan + phân loại** (catalyst / đồn đoán / tin vĩ mô) + **sentiment** nếu đủ dữ kiện + **provenance** (Fireant/GDELT) + **tuổi tin**. Tin đồn bắt buộc nhãn `CHƯA XÁC NHẬN`.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Tin nóng hôm nay
Output: Fireant posts 02-10 (quỹ bình ổn xăng dầu về KBNN; đất nền HN đổi tâm lý; chiến dịch làm sạch mã số thuế) · `news_symbol("VCB")` → posts lãi suất 0.1-6% → ≥5 headline có provenance, ≤9 calls. Thiếu provenance hoặc thiếu phân loại thì chưa đạt; sentiment không nhãn nguồn thì chưa đạt.
