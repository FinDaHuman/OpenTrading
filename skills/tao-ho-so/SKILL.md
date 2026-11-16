---
name: tao-ho-so
description: "Interviews the user (5 questions via ask_user) to build an investor profile — goals, horizon, capital, experience, assets — then writes INVESTOR.md. Use for onboarding or a profile refresh."
match_text: "Phỏng vấn 5 câu qua ask_user để lập hồ sơ nhà đầu tư (mục tiêu, khung thời gian, vốn, kinh nghiệm, tài sản) rồi soạn INVESTOR.md. Dùng khi onboarding hoặc làm mới hồ sơ."
activation: manual
triggers:
  keywords: [tạo hồ sơ, lập hồ sơ, khảo sát, onboarding, hồ sơ nhà đầu tư]
version: 1.1.1
---

# Tạo hồ sơ nhà đầu tư

Ask with the `ask_user` tool; do NOT list the questions as long text. Make 2 calls in a row: call 1 with questions 1–4, call 2 with question 5 (the tool allows 4 questions per call). Keep each question's wording and its 4 options A–D below exactly as written; option labels are short, the long text goes in `description`. The user can always type another answer. After the 2 calls, draft INVESTOR.md, show the draft, and explain how to save it with `/profile`.

## Khi nào dùng

- Use when: a new user, or an old profile the user wants refreshed.
- Do NOT use: the user only wants to change one item (tell them to edit INVESTOR.md directly).

## Lượt 1 — câu 1–4 (một lệnh ask_user duy nhất)

**Câu 1** (header: "Mục tiêu")
Question: "Mục tiêu chính của bạn khi tham gia thị trường trong 1–3 năm tới là gì?"
- A. label "Bảo toàn vốn" / description: "Ưu tiên an toàn, lợi nhuận chỉ cần nhỉnh hơn tiết kiệm (Ví dụ: ~7–10%/năm)."
- B. label "Tăng trưởng ổn định" / description: "Tăng trưởng tài sản ổn định, chấp nhận biến động vừa phải (Ví dụ: ~15–20%/năm)."
- C. label "Tối đa hóa lợi nhuận" / description: "Săn cơ hội tăng trưởng vượt trội hoặc đột biến (Ví dụ: >25–30%/năm)."
- D. label "Dòng tiền" / description: "Tạo thu nhập thụ động đều đặn (cổ tức, yield trading)."

**Câu 2** (header: "Thời hạn")
Question: "Bạn dự định giữ một vị thế/cổ phiếu trong bao lâu và tần suất theo dõi thị trường của bạn như thế nào?"
- A. label "Ngắn hạn" / description: "Lướt sóng T+, vài ngày đến vài tuần — theo dõi bảng điện liên tục hằng ngày."
- B. label "Trung hạn" / description: "Theo sóng ngành, từ 1–6 tháng — theo dõi thị trường vài lần một tuần."
- C. label "Dài hạn" / description: "Trên 1 năm, đầu tư theo chu kỳ/nền tảng doanh nghiệp — thi thoảng mới xem lại tài khoản."
- D. label "Linh hoạt" / description: "Tùy theo tín hiệu kỹ thuật/dòng tiền của thị trường."

**Câu 3** (header: "Nguồn vốn")
Question: "Nguồn vốn bạn dùng để đầu tư/giao dịch có đặc điểm gì?"
- A. label "Nhàn rỗi dài hạn" / description: "Không cần dùng đến trong ít nhất 1–2 năm tới."
- B. label "Nhàn rỗi ngắn hạn" / description: "Có thể cần rút ra một phần trong 3–6 tháng tới."
- C. label "Có đòn bẩy" / description: "Margin, vay mượn, hoặc cần xoay vòng vốn nhanh."
- D. label "Tiết kiệm quan trọng" / description: "Không thể chấp nhận mất mát lớn."

**Câu 4** (header: "Kinh nghiệm")
Question: "Mức độ am hiểu và kinh nghiệm của bạn đối với thị trường tài chính / chứng khoán như thế nào?"
- A. label "Mới bắt đầu" / description: "Chưa hiểu rõ thuật ngữ kỹ thuật (P/E, RSI, Margin, Orderbook...) — agent cần giải thích chi tiết, trình bày đơn giản."
- B. label "Cơ bản" / description: "Đã giao dịch thực tế 1–2 năm, hiểu các chỉ số cơ bản và cách đọc biểu đồ."
- C. label "Thành thạo" / description: "Đã qua cả mùa Uptrend & Downtrend, hiểu cơ chế thị trường, phân tích kỹ thuật/cơ bản nâng cao."
- D. label "Chuyên gia" / description: "Kiến thức chuyên sâu về tài chính, derivatives, hoặc hệ thống giao dịch tự động (algorithmic)."

## Lượt 2 — câu 5 (một lệnh ask_user riêng)

**Câu 5** (header: "Tài sản")
Question: "Khung danh mục bạn muốn tập trung đầu tư bao gồm các loại tài sản tài chính (phi vật thể) nào dưới đây?"
- A. label "Chỉ cổ phiếu/ETF" / description: "Chứng khoán cơ sở niêm yết + chứng chỉ quỹ — tập trung, dễ quản lý."
- B. label "Cổ phiếu + trái phiếu" / description: "Cộng trái phiếu doanh nghiệp / tiền gửi tối ưu lãi suất — tăng trưởng kết hợp phòng thủ."
- C. label "Kèm phái sinh + crypto" / description: "Cổ phiếu + phái sinh (VN30F) + tiền điện tử/tài sản số — chấp nhận biến động cao 24/7."
- D. label "Toàn bộ năng động" / description: "Mọi tài sản thanh khoản cao: cổ phiếu, phái sinh, crypto, forex/commodity index."

## Map câu trả lời sang hành vi agent (dùng khi soạn INVESTOR.md)

| Câu | Answer → agent behaviour |
|---|---|
| 1 | A: prioritise capital + dividends, strong risk warnings; B: balance growth/risk; C: accept volatility, look for opportunities; D: prioritise yield/dividends |
| 2 | A: use T+/daily data, follow closely; B: 1–6 month sector waves; C: cycles/fundamentals, few interruptions; D: flexible, by market signals |
| 3 | A: analyse on a long horizon; B: flag the risk of locking capital up long; C: include margin/leverage risk in the analysis; D: stress the risk of capital loss and preservation |
| 4 | A: explain every term, keep it simple; B: explain new concepts as they come; C: use professional terms; D: talk as peers, go deep technically |
| 5 | A: only cash-equity tools; B: add bonds/rates; C: add derivatives + crypto; D: the whole asset universe |

## Soạn và lưu

1. From the answers, write INVESTOR.md in 4 sections, in Vietnamese: Khung đầu tư (questions 1+2) / Khấu hao vốn & đòn bẩy (question 3) / Kinh nghiệm & Vũ trụ tài sản (questions 4+5) / Cách muốn được hỗ trợ (inferred from question 4).
2. Show the draft verbatim in the chat for the user to review.
3. How to save: run `/profile` to create the file, then paste the draft into the INVESTOR.md it points to (changes apply from the next question).
