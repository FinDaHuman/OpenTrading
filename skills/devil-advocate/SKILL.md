---
name: devil-advocate
description: "Phản biện luận điểm đầu tư để chống thiên kiến xác nhận: tóm tắt luận điểm, nêu 3-5 lý do nó có thể SAI kèm dấu hiệu theo dõi, điều kiện phủ định. Luôn dùng skill này khi user hỏi về mã họ đang nắm hoặc đã thích, xin ý kiến mua/giữ, hoặc yêu cầu phản biện/bear case — ví dụ 'đang giữ HPG có nên giữ không', 'bear case cho VCB là gì' — ngay cả khi user không nói rõ muốn 'phản biện'."
activation: auto
triggers:
  keywords: [phản biện, bear case, có nên giữ, rủi ro gì, đang nắm, đang giữ]
version: 1.2.0
---

# Countering Investment Bias

Người dùng hỏi về cổ phiếu họ đã mua hoặc đã thích thì mặc định họ đang thiên kiến xác nhận — nhiệm vụ là phản biện, không phải chê bai hay kết luận thay. Giọng trung lập, không mỉa mai.

## When to Use

- Dùng khi: user nói đang nắm/đang giữ một mã, hỏi có nên giữ không, rủi ro gì, xin bear case, hoặc yêu cầu phản biện luận điểm mua/giữ.
- Khi KHÔNG dùng (dùng skill khác thay thế): hỏi định nghĩa thuật ngữ (dùng `explain-term`); xin chart/nến (dùng `ve-bieu-do-ky-thuat`); hỏi cơ chế sàn/phiên/biên độ (dùng `vn-market-basics`).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: tóm tắt luận điểm (xác nhận hiểu đúng)
- [ ] Step 2: 3-5 lý do có thể SAI + dấu hiệu theo dõi
- [ ] Step 3: điều kiện phủ định
```

**Step 1: Tóm tắt luận điểm trong 1–2 câu.**

Xác nhận hiểu đúng trước khi phản biện; không bóp méo luận điểm để dễ bác bỏ.

**Step 2: Liệt kê 3–5 lý do mạnh nhất khiến luận điểm có thể SAI.**

Phủ 5 mặt: ngành, doanh nghiệp, định giá, vĩ mô, thanh khoản. Mỗi lý do kèm 1 dấu hiệu cụ thể cần theo dõi (chỉ số/sự kiện nào cho thấy rủi ro đang xảy ra) — phản biện không có dấu hiệu theo dõi là phản biện chung chung, vô dụng.

**Step 3: Nêu điều kiện phủ định.**

Sự kiện nào xảy ra thì luận điểm nên bị bỏ. Không kết luận mua/bán thay user.

## Template

ALWAYS use this exact output structure: luận điểm tóm tắt (1–2 câu) · 3–5 rủi ro + dấu hiệu theo dõi từng cái · điều kiện phủ định (khi nào nên bỏ luận điểm).

## Examples

**Example 1:**
Input: đang giữ HPG, có nên giữ không
Output: tóm tắt 1–2 câu + 3–5 rủi ro có dấu hiệu + điều kiện phủ định, giọng trung lập, không khuyến nghị mua/bán.

**Anti-pattern (không làm thế này):** chỉ khen theo user để xác nhận thiên kiến; tự kết luận "nên bán".
