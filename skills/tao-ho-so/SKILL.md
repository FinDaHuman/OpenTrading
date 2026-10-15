---
name: tao-ho-so
description: "Phỏng vấn 7 câu để lập hồ sơ nhà đầu tư (mục tiêu lợi nhuận, khung thời gian, vốn, kinh nghiệm, tài sản) rồi soạn INVESTOR.md. Dùng khi onboarding hoặc làm mới hồ sơ."
activation: manual
triggers:
  keywords: [tạo hồ sơ, lập hồ sơ, khảo sát, onboarding, hồ sơ nhà đầu tư]
version: 1.0.0
---

# Tạo hồ sơ nhà đầu tư

Hỏi cả 7 câu trong MỘT tin nhắn (kèm phương án A–D để user chỉ cần trả lời "1B 2A 3C…"), user trả lời 1 lần. Rồi soạn INVESTOR.md hoàn chỉnh, hiện bản thảo, hướng dẫn lưu bằng `/profile`.

## Khi nào dùng

- Dùng khi: user mới, hoặc hồ sơ đã cũ và muốn làm mới.
- Khi KHÔNG dùng: user chỉ muốn sửa 1 mục (bảo họ sửa trực tiếp file INVESTOR.md).

## 7 câu hỏi (hỏi nguyên văn, giữ đúng số thứ tự)

**1. Mục tiêu & Kỳ vọng lợi nhuận (Goal & Return Expectation)**
Mục đích: xác định chiến lược Tăng trưởng (Growth), Dòng tiền (Yield/Income), hay Bảo toàn vốn (Capital Preservation).
Mục tiêu chính của bạn khi tham gia thị trường trong 1–3 năm tới là gì?
- A. Bảo toàn vốn, ưu tiên sự an toàn, lợi nhuận chỉ cần nhỉnh hơn tiết kiệm (Ví dụ: ~7–10%/năm).
- B. Tăng trưởng tài sản ổn định, chấp nhận biến động vừa phải (Ví dụ: ~15–20%/năm).
- C. Tối đa hóa lợi nhuận, tìm kiếm cơ hội tăng trưởng vượt trội hoặc đột biến (Ví dụ: >25–30%/năm).
- D. Tạo dòng tiền/thu nhập thụ động đều đặn (Cổ tức, yield trading).

**2. Ràng buộc cứng (do skill soạn — user chưa chốt câu này)**
Mục đích: ghi các giới hạn không được vượt qua trong mọi khuyến nghị.
Điều gì sau đây là giới hạn cứng của bạn? (chọn tất cả đúng)
- A. Không margin, không phái sinh, không vay mượn để đầu tư.
- B. Có ngành không bao giờ đụng vào (ghi rõ ngành).
- C. Giới hạn tỷ trọng tối đa cho một mã (ghi rõ %, ví dụ 10%).
- D. Không có ràng buộc đặc biệt.

**3. Thời gian đầu tư & Khung thời gian giao dịch (Investment Horizon & Timeframe)**
Mục đích: xác định tần suất giao dịch (lướt sóng/swing/dài hạn) và chu kỳ phân tích dữ liệu.
Bạn dự định giữ một vị thế/cổ phiếu trong bao lâu và tần suất theo dõi thị trường của bạn như thế nào?
- A. Ngắn hạn (Lướt sóng T+, vài ngày đến vài tuần) – Theo dõi bảng điện liên tục hằng ngày.
- B. Trung hạn (Theo sóng ngành, từ 1–6 tháng) – Theo dõi thị trường vài lần một tuần.
- C. Dài hạn (Trên 1 năm, đầu tư theo chu kỳ/nền tảng doanh nghiệp) – Thi thoảng mới xem lại tài khoản.
- D. Linh hoạt tùy theo tín hiệu kỹ thuật/dòng tiền mà agent đưa ra.

**4. Danh mục hiện tại & Cách muốn được hỗ trợ (do skill soạn — user chưa chốt câu này)**
Mục đích: cho agent bối cảnh vị thế và phong cách trả lời mong muốn.
- Danh mục hiện tại của bạn gồm những mã nào (có thể bỏ qua nếu không muốn tiết lộ)?
- Khi trả lời, bạn muốn: (A) luôn nêu bear case trước; (B) nói thẳng kể cả khi ngược ý bạn; (C) cấm dùng từ "nên mua"/"nên bán", chỉ trình bày kịch bản + điều kiện; (D) mặc định như hiện tại.

**5. Khấu hao vốn & Áp lực tài chính (Financial Liquidity & Leverage)**
Mục đích: tiền nhàn rỗi hay tiền áp lực — quyết định có được đề xuất Margin không.
Nguồn vốn bạn dùng để đầu tư/giao dịch có đặc điểm gì?
- A. Tiền nhàn rỗi hoàn toàn, không cần dùng đến trong ít nhất 1–2 năm tới.
- B. Tiền nhàn rỗi ngắn hạn, có thể cần rút ra một phần trong 3–6 tháng tới.
- C. Tiền có sử dụng đòn bẩy (Margin, vay mượn) hoặc cần xoay vòng vốn nhanh.
- D. Khoản tiết kiệm quan trọng (không thể chấp nhận mất mát lớn).

**6. Mức độ hiểu biết & Kinh nghiệm thị trường (Market Knowledge & Experience)**
Mục đích: quyết định ngôn ngữ giao tiếp (giải thích chi tiết hay thuật ngữ chuyên ngành) và mức độ tự động (tự chạy hay cần xác nhận).
Mức độ am hiểu và kinh nghiệm của bạn đối với thị trường tài chính / chứng khoán như thế nào?
- A. Mới bắt đầu: chưa hiểu rõ các thuật ngữ kỹ thuật (như P/E, RSI, Margin, Orderbook...). (Agent cần giải thích chi tiết, khuyến nghị chiến lược đơn giản).
- B. Cơ bản: đã giao dịch thực tế 1–2 năm, hiểu các chỉ số cơ bản và cách đọc biểu đồ.
- C. Thành thạo / Chuyên sâu: đã có kinh nghiệm qua cả mùa Uptrend & Downtrend, hiểu rõ cơ chế thị trường, phân tích kỹ thuật/cơ bản nâng cao.
- D. Chuyên gia / Algorithmic Trader: kiến thức chuyên sâu về tài chính, derivatives, hoặc hệ thống giao dịch tự động.

**7. Phạm vi lớp tài sản đầu tư (Asset Allocation Scope)**
Mục đích: xác định vũ trụ đầu tư — chỉ chứng khoán hay cả crypto/trái phiếu/phái sinh.
Khung danh mục bạn muốn tập trung đầu tư bao gồm các loại tài sản tài chính (phi vật thể) nào dưới đây?
- A. Chỉ Chứng khoán cơ sở: cổ phiếu niêm yết, chứng chỉ quỹ ETF (tập trung, dễ quản lý).
- B. Chứng khoán & Thu nhập cố định: cổ phiếu + trái phiếu doanh nghiệp / tiền gửi tối ưu lãi suất (tăng trưởng + phòng thủ).
- C. Đa dạng hóa Tài chính số & Phái sinh: cổ phiếu + phái sinh (VN30F) + tiền điện tử + tài sản số khác (chấp nhận biến động cao 24/7).
- D. Tất cả tài sản tài chính năng động: cổ phiếu, phái sinh, crypto, forex/commodity index có thanh khoản cao.

## Map câu trả lời sang hành vi agent (dùng khi soạn INVESTOR.md)

| Câu | Đáp án → hành vi |
|---|---|
| 1 | A: ưu tiên vốn + cổ tức, cảnh báo rủi ro mạnh; B: cân bằng tăng trưởng/rủi ro; C: chấp nhận biến động, săn cơ hội; D: ưu tiên yield/cổ tức |
| 2 | Ghi nguyên văn vào mục Ràng buộc — mọi khuyến nghị phải tôn trọng |
| 3 | A: dùng dữ liệu T+/ngày, theo dõi sát; B: sóng ngành 1–6 tháng; C: chu kỳ/nền tảng, ít làm phiền; D: theo tín hiệu agent |
| 4 | Ghi mã đang nắm (nếu có) + phong cách trả lời vào INVESTOR.md |
| 5 | A: được đề xuất chiến lược dài; B: tránh khóa vốn dài; C: được bàn margin/đòn bẩy; D: cấm mọi đề xuất rủi ro cao, nhấn mạnh bảo toàn |
| 6 | A: giải thích mọi thuật ngữ, chiến lược đơn giản, mọi hành động cần xác nhận; B: giải thích khi gặp khái niệm mới; C: dùng thuật ngữ chuyên ngành, được tự chạy các bước phân tích; D: trao đổi ngang hàng, được đề xuất tự động hóa |
| 7 | A: chỉ dùng tool chứng khoán cơ sở; B: thêm trái phiếu/lãi suất; C: thêm phái sinh + crypto; D: toàn bộ vũ trụ tài sản |

## Soạn và lưu

1. Từ câu trả lời, viết INVESTOR.md theo 4 mục: Khung đầu tư / Ràng buộc / Danh mục & phạm vi / Cách muốn được hỗ trợ.
2. Hiện nguyên văn bản thảo trong chat để user duyệt.
3. Hướng dẫn lưu: chạy `/profile` để tạo file, rồi dán bản thảo vào file INVESTOR.md được chỉ (thay đổi có hiệu lực từ lượt hỏi tiếp theo).
