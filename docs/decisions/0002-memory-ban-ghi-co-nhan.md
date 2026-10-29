# 0002 · Memory trong hội thoại: bản ghi có nhãn, nối sau lịch sử

- Trạng thái: đề xuất, 28/10/2026 (người phụ trách memory đã chốt; chờ nhóm duyệt)
- Ghi đè: `docs/memory/design-v5.md` §4.1 ("không thêm body của auto-recall vào message được lưu") và §5.3 (overlay tạm)
- Căn cứ: `docs/memory/ra-soat-v5.md` K3, K5, §B3, quyết định Q1

## Bối cảnh

Thiết kế v5 đưa memory vào hội thoại theo hai đường, với hai luật lưu ngược nhau:

| Đường | Có lưu vào lịch sử và file phiên? | Lượt sau có gửi lại? |
| --- | --- | --- |
| Host tự chèn (overlay tạm) | Không, chỉ lưu tham chiếu | Không, mỗi lượt dựng lại |
| Model gọi `memory_read` | Có, kết quả tool lưu nguyên văn | Có, tới khi nén |

Hệ quả:

1. **Sửa và xoá chỉ có hiệu lực một nửa.** Sửa luận điểm HPG lên bản 3 giữa phiên thì overlay hiện bản 3, nhưng lịch sử vẫn còn bản 2 từ một lần gọi tool trước đó, nên model thấy cả hai bản.
2. **Prompt cache vỡ ở mọi lượt.** Lượt N có khối overlay. Sang lượt N+1, câu hỏi lượt N trong lịch sử không còn khối đó, nên toàn bộ lượt N bị tính lại.
3. **File phiên không chứa đúng những gì model đã thấy.** Vì vậy không giải thích lại được một câu trả lời cũ.

Lõi hiện có sẵn kênh nhắc nhở: nội dung gắn vào tin nhắn người dùng của lượt hiện tại và **được lưu** cùng tin nhắn. `recall()` của `MemoryProvider` đã đi qua kênh này.

## Quyết định

Mọi khối memory, dù host chèn hay model đọc qua `memory_read`, được **lưu đúng như đã gửi, có nhãn**, và nối sau lịch sử. Cụ thể:

1. **Định dạng khối cố định từng byte.** Dòng đầu là nhãn, gồm loại, chủ đề hoặc ID, số bản, ngày ghi tuyệt đối, nguồn. Ví dụ: `[Memory · luận điểm · HPG · bản 3 · ghi 20/01/2027 · người dùng tự ghi]`. Không dùng ngày tương đối. Nhãn nói rõ đây là dữ liệu người dùng đã lưu từ trước, không phải tin nhắn vừa gửi.
2. **Chỉ chèn khi chưa có.** Khối của một chủ đề đã có trong lịch sử thì không chèn lại.
3. **Bản mới thì nối thêm.** Chủ đề có bản mới hơn khối trong lịch sử thì chèn khối bản mới, kèm dòng "thay cho bản N ở lượt trước".
4. **Sửa hoặc xoá giữa phiên luôn được báo** ở lượt kế tiếp bằng một dòng nhắc ngắn, kể cả khi chủ đề không được hỏi.
5. **Xoá thì che.**
   - Mọi khối của mục đó trong lịch sử đang mở, cả nhắc nhở lẫn kết quả tool, được thay bằng "[Memory #ID đã bị người dùng xoá]".
   - File phiên có thêm một **dòng che**, được áp mỗi khi đọc lại phiên.
   - Câu báo cho người dùng: "Đã ngừng dùng; nội dung được che khi đọc lại phiên; bản đã gửi provider không thu hồi được".
6. **`memory_read` dùng cùng định dạng.** Khối đã có trong lịch sử thì tool chỉ trả câu ngắn "đã có ở lượt …".
7. **Nén hội thoại:** bản tóm tắt chỉ giữ nhãn, không chép nội dung khối. Sau nén, khối được chèn lại ở bản hiện hành khi chủ đề còn liên quan.

**Làm theo hai đợt:**

| Đợt | Spec | Làm gì | Đụng lõi |
| --- | --- | --- | --- |
| Tối thiểu | 002 | Khối có nhãn đi qua kênh `recall()` có sẵn. Provider tự nhớ trong RAM khối nào đã chèn trong từng phiên. Xoá thì báo ở lượt sau | Không, ngoài việc đăng ký provider |
| Đầy đủ | 006 | Lõi đưa danh sách nhãn đang có trong lịch sử cho memory; che khối trong lịch sử đang mở; dòng che trong file phiên; mã lượt; mẫu tóm tắt khi nén chỉ giữ nhãn | Có |

## Hệ quả

**Được:**
- Một luật cho mọi đường.
- Sửa và xoá có hiệu lực ngay trong phiên.
- Lượt sau trúng prompt cache phần lượt trước; cache chỉ vỡ khi xoá, việc này hiếm.
- File phiên chứa đúng những gì model đã thấy, nên dùng được làm bằng chứng.

**Mất và rủi ro:**
- Nội dung đã xoá **vẫn nằm trong file phiên** trên đĩa, chỉ được che khi đọc lại. Bản đã gửi provider không thu hồi được. Ứng dụng không được hứa đã xoá vật lý.
- Ngữ cảnh dài hơn overlay, vì khối nằm lại tới khi nén. Giảm bằng ngân sách memory theo phiên.
- Model có thể nhầm bản cũ dù có nhãn. Giảm bằng dòng "thay cho" và ca kiểm.
- **Đợt tối thiểu có hai giới hạn:** sau nén hoặc mở lại phiên, khối có thể bị chèn lại hoặc thiếu; nội dung đã xoá chưa được che trong lịch sử đang mở. Spec 006 gỡ cả hai.
- Đợt đầy đủ cần chủ repo duyệt thay đổi ở phần lưu phiên, vòng agent, hợp đồng `MemoryProvider` và phần nén hội thoại.
