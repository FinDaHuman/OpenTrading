---
name: tao-ho-so
description: "Phỏng vấn 5 câu qua ask_user để lập hồ sơ nhà đầu tư (mục tiêu, khung thời gian, vốn, kinh nghiệm, tài sản) rồi soạn INVESTOR.md. Dùng khi onboarding hoặc làm mới hồ sơ."
activation: manual
triggers:
  keywords: [tạo hồ sơ, lập hồ sơ, khảo sát, onboarding, hồ sơ nhà đầu tư]
version: 1.1.0
---

# Tạo hồ sơ nhà đầu tư

Hỏi bằng tool `ask_user`, KHÔNG liệt kê câu hỏi dạng văn bản dài. Gọi 2 lượt liên tiếp: lượt 1 câu 1–4, lượt 2 câu 5 (tool giới hạn 4 câu/lượt). Mỗi câu giữ nguyên văn câu hỏi và 4 lựa chọn A–D ở dưới; nhãn option ngắn, phần mô tả dài đưa vào `description`. User luôn có thể tự nhập đáp án khác. Hết 2 lượt thì soạn INVESTOR.md, hiện bản thảo, hướng dẫn lưu bằng `/profile`.

## Khi nào dùng

- Dùng khi: user mới, hoặc hồ sơ đã cũ và muốn làm mới.
- Khi KHÔNG dùng: user chỉ muốn sửa 1 mục (bảo họ sửa trực tiếp file INVESTOR.md).

## Lượt 1 — câu 1–4 (một lệnh ask_user duy nhất)

**Câu 1** (header: "Mục tiêu")
Question: "Mục tiêu chính của bạn khi tham gia thị trường trong 1–3 năm tới là gì? Mục đích: xác định chiến lược Tăng trưởng (Growth), Dòng tiền (Yield), hay Bảo toàn vốn (Capital Preservation)?"
- A. label "Bảo toàn vốn" / description: "Ưu tiên an toàn, lợi nhuận chỉ cần nhỉnh hơn tiết kiệm (Ví dụ: ~7–10%/năm)."
- B. label "Tăng trưởng ổn định" / description: "Tăng trưởng tài sản ổn định, chấp nhận biến động vừa phải (Ví dụ: ~15–20%/năm)."
- C. label "Tối đa hóa lợi nhuận" / description: "Săn cơ hội tăng trưởng vượt trội hoặc đột biến (Ví dụ: >25–30%/năm)."
- D. label "Dòng tiền" / description: "Tạo thu nhập thụ động đều đặn (cổ tức, yield trading)."

**Câu 2** (header: "Thời hạn")
Question: "Bạn dự định giữ một vị thế/cổ phiếu trong bao lâu và tần suất theo dõi thị trường của bạn như thế nào?"
- A. label "Ngắn hạn" / description: "Lướt sóng T+, vài ngày đến vài tuần — theo dõi bảng điện liên tục hằng ngày."
- B. label "Trung hạn" / description: "Theo sóng ngành, từ 1–6 tháng — theo dõi thị trường vài lần một tuần."
- C. label "Dài hạn" / description: "Trên 1 năm, đầu tư theo chu kỳ/nền tảng doanh nghiệp — thi thoảng mới xem lại tài khoản."
- D. label "Linh hoạt" / description: "Tùy theo tín hiệu kỹ thuật/dòng tiền mà agent đưa ra."

**Câu 3** (header: "Nguồn vốn")
Question: "Nguồn vốn bạn dùng để đầu tư/giao dịch có đặc điểm gì? Mục đích: xác định tiền nhàn rỗi hay tiền áp lực, từ đó biết có nên đề xuất Margin (đòn bẩy) hay không?"
- A. label "Nhàn rỗi dài hạn" / description: "Không cần dùng đến trong ít nhất 1–2 năm tới."
- B. label "Nhàn rỗi ngắn hạn" / description: "Có thể cần rút ra một phần trong 3–6 tháng tới."
- C. label "Có đòn bẩy" / description: "Margin, vay mượn, hoặc cần xoay vòng vốn nhanh."
- D. label "Tiết kiệm quan trọng" / description: "Không thể chấp nhận mất mát lớn."

**Câu 4** (header: "Kinh nghiệm")
Question: "Mức độ am hiểu và kinh nghiệm của bạn đối với thị trường tài chính / chứng khoán như thế nào?"
- A. label "Mới bắt đầu" / description: "Chưa hiểu rõ thuật ngữ kỹ thuật (P/E, RSI, Margin, Orderbook...) — agent cần giải thích chi tiết, khuyến nghị đơn giản."
- B. label "Cơ bản" / description: "Đã giao dịch thực tế 1–2 năm, hiểu các chỉ số cơ bản và cách đọc biểu đồ."
- C. label "Thành thạo" / description: "Đã qua cả mùa Uptrend & Downtrend, hiểu cơ chế thị trường, phân tích kỹ thuật/cơ bản nâng cao."
- D. label "Chuyên gia" / description: "Kiến thức chuyên sâu về tài chính, derivatives, hoặc hệ thống giao dịch tự động (algorithmic)."

## Lượt 2 — câu 5 (một lệnh ask_user riêng)

**Câu 5** (header: "Tài sản")
Question: "Khung danh mục bạn muốn tập trung đầu tư bao gồm các loại tài sản tài chính (phi vật thể) nào dưới đây? Mục đích: xác định vũ trụ đầu tư của agent."
- A. label "Chỉ cổ phiếu/ETF" / description: "Chứng khoán cơ sở niêm yết + chứng chỉ quỹ — tập trung, dễ quản lý."
- B. label "Cổ phiếu + trái phiếu" / description: "Cộng trái phiếu doanh nghiệp / tiền gửi tối ưu lãi suất — tăng trưởng kết hợp phòng thủ."
- C. label "Kèm phái sinh + crypto" / description: "Cổ phiếu + phái sinh (VN30F) + tiền điện tử/tài sản số — chấp nhận biến động cao 24/7."
- D. label "Toàn bộ năng động" / description: "Mọi tài sản thanh khoản cao: cổ phiếu, phái sinh, crypto, forex/commodity index."

## Map câu trả lời sang hành vi agent (dùng khi soạn INVESTOR.md)

| Câu | Đáp án → hành vi |
|---|---|
| 1 | A: ưu tiên vốn + cổ tức, cảnh báo rủi ro mạnh; B: cân bằng tăng trưởng/rủi ro; C: chấp nhận biến động, săn cơ hội; D: ưu tiên yield/cổ tức |
| 2 | A: dùng dữ liệu T+/ngày, theo dõi sát; B: sóng ngành 1–6 tháng; C: chu kỳ/nền tảng, ít làm phiền; D: theo tín hiệu agent |
| 3 | A: được đề xuất chiến lược dài; B: tránh khóa vốn dài; C: được bàn margin/đòn bẩy; D: cấm mọi đề xuất rủi ro cao, nhấn mạnh bảo toàn |
| 4 | A: giải thích mọi thuật ngữ, chiến lược đơn giản, mọi hành động cần xác nhận; B: giải thích khi gặp khái niệm mới; C: dùng thuật ngữ chuyên ngành, được tự chạy các bước phân tích; D: trao đổi ngang hàng, được đề xuất tự động hóa |
| 5 | A: chỉ dùng tool chứng khoán cơ sở; B: thêm trái phiếu/lãi suất; C: thêm phái sinh + crypto; D: toàn bộ vũ trụ tài sản |

## Soạn và lưu

1. Từ câu trả lời, viết INVESTOR.md theo 4 mục: Khung đầu tư (câu 1+2) / Khấu hao vốn & đòn bẩy (câu 3) / Kinh nghiệm & Vũ trụ tài sản (câu 4+5) / Cách muốn được hỗ trợ (suy từ câu 4).
2. Hiện nguyên văn bản thảo trong chat để user duyệt.
3. Hướng dẫn lưu: chạy `/profile` để tạo file, rồi dán bản thảo vào file INVESTOR.md được chỉ (thay đổi có hiệu lực từ lượt hỏi tiếp theo).
