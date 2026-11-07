# 0005 · Ràng buộc có cấu trúc; `INVESTOR.md` chỉ người dùng viết

- Trạng thái: đề xuất, 28/10/2026 (người phụ trách memory đã chốt; chờ nhóm duyệt)
- Ghi đè: `docs/memory/design-v5.md` §2 và §6 (lệnh `/nho` ghi ràng buộc vào `INVESTOR.md`)
- Căn cứ: `docs/memory/ra-soat-v5.md` K6, K7, T7, T8, H8, §B7, §C3, quyết định Q4

## Bối cảnh

Trong v5, `INVESTOR.md` vừa là văn bản người dùng tự viết, vừa là kho để app ghi ràng buộc vào. Hệ quả:

- **Từng dòng ràng buộc không có định danh, không có phiên bản.** Vì vậy:
  - `/memory` không sửa hay xoá chính xác được một dòng;
  - không chỉ ra được câu trả lời đã dùng ràng buộc nào;
  - quyết định không ghi được bộ ràng buộc đang áp dụng;
  - chống ghi đè chỉ làm được trên cả file.
- **Ví dụ:** người dùng tự sửa "Không dùng margin" thành "Không dùng margin quá 20%". Một đề xuất "xoá ràng buộc 'Không dùng margin'" đang chờ duyệt không còn khớp dòng nào.
- **Đọc lỗi bị coi như không có ràng buộc (T7).** Code hiện tại nuốt mọi lỗi đọc `INVESTOR.md`.
- **Dòng mẫu bị gửi như ràng buộc thật (T8).** File mẫu có dòng "(ví dụ: …)" và được gửi nguyên văn.
- **Chọn nhầm ngăn rất nguy hiểm (K7).** Một ràng buộc lưu nhầm thành bài học thì không còn luôn có mặt, không tới agent con, và không ai được báo.

## Quyết định

1. **Ràng buộc và cách trình bày nằm trong `memory.db`** (ADR 0003):
   - có ID, các bản bất biến, phạm vi (mặc định "mọi tài khoản"), nguồn (gõ tay, thẻ đã xác nhận);
   - người dùng thêm, sửa, xoá qua lệnh và form, không qua model.
2. **Ràng buộc luôn có mặt.** Nạp vào phần hệ thống ở mọi request của agent chính, **không bao giờ cắt**. Không vừa ngân sách thì hoãn request và báo, không gửi thiếu. Ràng buộc nạp **độc lập với công tắc memory**: tắt sổ, mục lục và tool thì ràng buộc vẫn áp dụng.
3. **Agent con nhận ràng buộc do host gửi.** Đó là ràng buộc từ kho, đúng phạm vi, tính vào ngân sách của agent con. Không vừa thì agent con không chạy và báo lý do. Agent con **không** nhận `INVESTOR.md`, cách trình bày, luận điểm, bài học hay quyết định.
4. **`INVESTOR.md` chỉ người dùng viết.**
   - App không ghi vào file này.
   - File vẫn được gửi cho agent chính như hiện nay.
   - File mẫu mới đưa các ví dụ vào phần chú thích, không gửi đi. Mục "Ràng buộc" thay bằng một chú thích hướng dẫn thêm ràng buộc bằng lệnh.
5. **Phân biệt "chưa có" với "đọc lỗi".** Chưa có thì chạy bình thường. Đọc lỗi (file hồ sơ hoặc kho ràng buộc) thì **hoãn lượt** và báo, kèm lựa chọn "chạy không có ràng buộc ở lượt này" do người dùng bấm.
6. **Form chống chọn nhầm ngăn:**
   - hiện tiêu chí phân loại;
   - cảnh báo khi một câu dạng cấm đoán ("không bao giờ", "cấm", "tối đa … % danh mục") đang được lưu thành bài học;
   - kiểm trùng và mâu thuẫn giữa ràng buộc và bài học.
7. **Để sau:** nhập các dòng ràng buộc cũ trong `INVESTOR.md` của người dùng hiện có vào kho.

**Làm theo hai bước:**

| Spec | Làm gì |
| --- | --- |
| 002 | Ràng buộc đi qua `instructions()` của provider: phần hệ thống, không cắt, nhưng chỉ khi provider v5.1 đang bật |
| 005 | Nạp độc lập với công tắc, gửi cho agent con, xử lý đọc lỗi và file mẫu (sửa lõi) |

## Hệ quả

**Được:**
- Sửa và xoá chính xác từng ràng buộc.
- Câu trả lời và quyết định chỉ ra được bộ ràng buộc đã dùng.
- Agent con nhận ràng buộc có cấu trúc, và không bao giờ nhận dòng mẫu.

**Mất và rủi ro:**
- Sở thích của người dùng nằm ở hai nơi: `INVESTOR.md` (văn bản tự do) và kho ràng buộc. Giao diện phải nói rõ nơi nào dùng cho việc gì.
- Spec 005 sửa phần nạp hồ sơ và phần tạo agent con, là file của chủ repo, cần duyệt.
- Trước khi spec 005 xong, agent con chưa nhận ràng buộc.
