---
name: vn-market-basics
description: "Giải thích cơ chế giao dịch chứng khoán Việt Nam (sàn HOSE/HNX/UPCoM, phiên ATO/liên tục/ATC, biên độ, bước giá, lô, chu kỳ thanh toán T+2, loại lệnh LO/MP). Luôn dùng skill này khi user hỏi quy định/cơ chế giao dịch — ví dụ 'biên độ HOSE bao nhiêu', 'lô chẵn lô lẻ là sao' — ngay cả khi user không nói rõ muốn 'hỏi cơ chế'."
activation: auto
triggers:
  keywords: [biên độ, bước giá, lô chẵn, lô lẻ, ATO, ATC, loại lệnh, thanh toán T, phiên giao dịch]
version: 1.2.0
---

# Explaining Vietnam Market Mechanics

Trả lời gọn theo từng sàn (nếu khác nhau) + ghi chú KRX/CCP/nâng hạng có thể đã cũ + 1 dòng khuyên đối chiếu nguồn chính thức. Không bao giờ đưa ra con số giá hay chỉ số thị trường hiện tại trong skill này.

## When to Use

- Dùng khi: user hỏi sàn HOSE/HNX/UPCoM, phiên ATO/liên tục/ATC, biên độ giá, bước giá, lô chẵn/lẻ, chu kỳ thanh toán, loại lệnh (LO, MP, ATO, ATC...).
- Khi KHÔNG dùng (dùng skill khác thay thế): hỏi P/E, EPS, ROE, margin là gì (chỉ dùng `explain-term`); hỏi mã đang nắm có nên giữ không (chỉ dùng `devil-advocate`); xin giá/chỉ số hiện tại (chỉ dùng skill phân tích).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: xác định sàn liên quan (tách HOSE/HNX/UPCoM)
- [ ] Step 2: trả lời theo quy tắc KRX hiện hành + ghi chú có thể đã cũ
- [ ] Step 3: khuyên đối chiếu nguồn chính thức
```

**Step 1: Xác định sàn liên quan.**

Phân biệt rõ HOSE/HNX/UPCoM khi quy định khác nhau; không gộp biên độ/bước giá/lô cả 3 sàn thành 1 số.

**Step 2: Trả lời theo quy tắc KRX hiện hành.**

Quy định thay đổi theo thời gian (hệ thống KRX, lộ trình CCP, nâng hạng FTSE) — bắt buộc nói rõ thông tin theo hiểu biết của model, có thể đã cũ. Nói chắc chắn về quy định mới mà không ghi chú này là sai.

**Step 3: Khuyên đối chiếu nguồn chính thức.**

Bắt buộc khuyên user đối chiếu thông báo của sở giao dịch hoặc CTCK. Không tiện trả lời kèm giá hiện tại — chỉ cơ chế, không số thị trường.

## Template

ALWAYS use this exact output structure: trả lời gọn theo từng sàn (nếu khác nhau) · ghi chú KRX/CCP/nâng hạng có thể đã cũ · 1 dòng khuyên đối chiếu nguồn chính thức.

## Examples

**Example 1:**
Input: Biên độ HOSE bao nhiêu
Output: số theo sàn + ghi chú KRX có thể cũ + dòng khuyên đối chiếu sở/CTCK, không kèm giá thị trường.
