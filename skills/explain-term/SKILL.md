---
name: explain-term
description: "Giải thích một thuật ngữ chứng khoán (P/E, EPS, ROE, margin, ATO/ATC, room ngoại, T+2) bằng tiếng Việt đơn giản, ví dụ giả định và bẫy hay gặp. Dùng khi hỏi X là gì."
activation: auto
triggers:
  keywords: [là gì, nghĩa là gì, giải thích, khái niệm, thuật ngữ]
version: 1.3.0
---

# Giải thích thuật ngữ

Trả lời đúng 5 bước, gọn nhẹ, không lan sang phân tích mã hay khuyến nghị. Mọi số minh họa là số tròn giả định — bắt buộc ghi rõ "ví dụ giả định", không bao giờ để user tưởng là số thật.

## Khi nào dùng

- Dùng khi: user hỏi một thuật ngữ, chỉ số hoặc khái niệm là gì (P/E, EPS, ROE, margin, ATO/ATC, room ngoại, T+2...).
- Khi KHÔNG dùng (dùng skill khác thay thế): phản biện luận điểm mua/giữ (dùng `devil-advocate`); phân tích mã cụ thể (dùng `phan-tich-chuyen-sau-1-ma`); vẽ chart (dùng `ve-bieu-do-ky-thuat`).

## Các bước

**Bước 1–2: Định nghĩa + công thức.**

Định nghĩa trong một câu, không dùng biệt ngữ khác chưa giải thích. Công thức viết bằng chữ, không tự thay số thật.

**Bước 3: Ví dụ minh họa.**

Số tròn giả định, bắt buộc ghi rõ "ví dụ giả định".

**Bước 4: Cách dùng thực tế ở VN + 1 bẫy hay gặp.**

Ví dụ: P/E thấp ảo do lợi nhuận đột biến, margin call, room ngoại khóa.

**Bước 5: Kết thúc bằng 1 câu hỏi gợi mở.**

Giúp user đào sâu (ví dụ "bạn muốn xem P/E này so với ngành không?"). Chỉ giải thích 1 thuật ngữ/lượt.

## Cấu trúc câu trả lời

Trình bày theo thứ tự: định nghĩa 1 câu · công thức bằng chữ · ví dụ giả định (ghi rõ giả định) · cách dùng ở VN + bẫy hay gặp · 1 câu hỏi gợi mở.

## Ví dụ

**Ví dụ 1:**
Hỏi: P/E là gì
Trả lời: định nghĩa 1 câu + công thức chữ + ví dụ giả định có ghi rõ + bẫy VN + 1 câu hỏi gợi mở.

**Tránh:** định nghĩa bằng biệt ngữ khó hơn; quên ghi "ví dụ giả định" khiến user tưởng số thật; trả lời dài như giáo trình.
