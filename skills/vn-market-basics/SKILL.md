---
name: vn-market-basics
description: "Giải thích cơ chế giao dịch VN: sàn HOSE/HNX/UPCoM, phiên ATO/ATC, biên độ, bước giá, lô, T+2, loại lệnh. Dùng khi hỏi quy định giao dịch."
activation: auto
triggers:
  keywords: [biên độ, bước giá, lô chẵn, lô lẻ, ATO, ATC, loại lệnh, thanh toán T, phiên giao dịch]
version: 1.3.0
---

# Cơ chế giao dịch Việt Nam

Trả lời gọn theo từng sàn (nếu khác nhau) + ghi chú KRX/CCP/nâng hạng có thể đã cũ + 1 dòng khuyên đối chiếu nguồn chính thức. Không bao giờ đưa ra con số giá hay chỉ số thị trường hiện tại trong skill này.

## Khi nào dùng

- Dùng khi: user hỏi sàn HOSE/HNX/UPCoM, phiên ATO/liên tục/ATC, biên độ giá, bước giá, lô chẵn/lẻ, chu kỳ thanh toán, loại lệnh (LO, MP, ATO, ATC...).
- Khi KHÔNG dùng (dùng skill khác thay thế): hỏi P/E, EPS, ROE, margin là gì (chỉ dùng `explain-term`); hỏi mã đang nắm có nên giữ không (chỉ dùng `devil-advocate`); xin giá/chỉ số hiện tại (chỉ dùng skill phân tích).

## Các bước

**Bước 1: Xác định sàn liên quan.**

Phân biệt rõ HOSE/HNX/UPCoM khi quy định khác nhau; không gộp biên độ/bước giá/lô cả 3 sàn thành 1 số.

**Bước 2: Trả lời theo quy tắc KRX hiện hành.**

Quy định thay đổi theo thời gian (hệ thống KRX, lộ trình CCP, nâng hạng FTSE) — bắt buộc nói rõ thông tin theo hiểu biết của model, có thể đã cũ. Nói chắc chắn về quy định mới mà không ghi chú này là sai.

**Bước 3: Khuyên đối chiếu nguồn chính thức.**

Bắt buộc khuyên user đối chiếu thông báo của sở giao dịch hoặc CTCK. Không tiện trả lời kèm giá hiện tại — chỉ cơ chế, không số thị trường.

## Cấu trúc câu trả lời

Trình bày theo thứ tự: trả lời gọn theo từng sàn (nếu khác nhau) · ghi chú KRX/CCP/nâng hạng có thể đã cũ · 1 dòng khuyên đối chiếu nguồn chính thức.

## Ví dụ

**Ví dụ 1:**
Hỏi: Biên độ HOSE bao nhiêu
Trả lời: số theo sàn + ghi chú KRX có thể cũ + dòng khuyên đối chiếu sở/CTCK, không kèm giá thị trường.
