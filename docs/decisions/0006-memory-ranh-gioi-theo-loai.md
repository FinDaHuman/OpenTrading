# 0006 · Ranh giới theo loại memory: bảng chính sách; agent con không đọc lịch sử phiên

- Trạng thái: đề xuất, 28/10/2026 (người phụ trách memory đã chốt; chờ nhóm duyệt)
- Ghi đè: không có. Đây là phần bổ sung cho `docs/memory/design-v5.md` §7
- Căn cứ: `docs/memory/ra-soat-v5.md` K9, H5, §B7, §B8, §C2, quyết định Q5 và Q6

## Bối cảnh

**Agent con đọc được mọi phiên cũ (K9).** Bộ tool của agent con được tính như sau:

> tool của agent chính − danh sách loại trừ cố định − tool có nguồn `memory:`

Hai tool đọc lịch sử phiên (`session_list`, `session_get`) không nằm trong danh sách loại trừ và cũng không có nguồn `memory:`, nên phần lớn các loại agent con có hai tool này. Agent con đọc được phiên ở mọi thư mục.

Theo ADR 0002, file phiên chứa nguyên văn các khối memory. Như vậy agent con có một đường vòng để đọc luận điểm và bài học, và sau này cả quyết định nếu được chia sẻ. Đó đúng là thứ nguyên tắc "agent con không nhận sổ" muốn chặn.

Agent con còn đọc nội dung bên ngoài như trang web và tin tức, là đầu vào không tin cậy. Nếu một trang web độc yêu cầu "đọc các phiên trước của người dùng" thì agent con làm được.

**Mỗi khối tự kiểm loại memory theo cách riêng (H5).** Có ít nhất năm nơi cần biết một loại memory có được đi qua hay không:
- lắp request;
- mục lục;
- `memory_read`;
- agent con;
- tool lịch sử.

Chỉ cần quên ở một nơi là rò. K9 chính là một lần quên như vậy.

## Quyết định

1. **Agent con không có tool lịch sử phiên.** `session_list`, `session_get`, và `session_search` khi có, được thêm vào danh sách tool agent con không bao giờ nhận. Agent con cần bối cảnh từ lịch sử thì agent chính tự đọc rồi trích đoạn cần thiết vào lời giao việc.
2. **Một bảng chính sách khai báo** trong code memory là nguồn sự thật duy nhất cho việc mỗi loại memory đi đâu. Mọi đường đọc **hỏi bảng**, không tự quyết. Bảng rút gọn:

   | Loại | Phần hệ thống | Mục lục | Khối khi chủ đề tập trung | `memory_read` | Agent con | Tool lịch sử |
   | --- | --- | --- | --- | --- | --- | --- |
   | Ràng buộc | Có, không cắt | — | — | Có | **Có** | Có |
   | Cách trình bày | Có | — | — | Có | Không | Có |
   | Luận điểm | — | Tên mã | Có | Có | Không | Có |
   | Bài học | — | Tên bài | Không | Có | Không | Có |
   | Quyết định | **Không** | **Không** | **Không** | **Không** | **Không** | Chỉ khi đã chia sẻ (sau này) |

3. **Đặt tên cột theo bốn ý của Cedar:** ai (agent chính, agent con, tool lịch sử) · làm gì (đọc vào request, đọc qua tool, đề xuất, làm cho có hiệu lực) · loại memory nào · trong bối cảnh nào (đã chia sẻ chưa). Mục đích là sau này chuyển sang một bộ máy chính sách thật được dễ.
4. **Không dùng bộ máy chính sách** (Cedar, OPA) ở thời điểm này. Bảng chỉ là một hằng số trong code, kèm test.
5. **Test duyệt bảng:** tạo một mục cho mỗi loại, chạy qua mọi đường đọc (phần hệ thống, mục lục, khối, tool, agent con, tool lịch sử, xuất), rồi đối chiếu với bảng. Ví dụ: không request nào gửi model chứa nội dung quyết định.
6. **Để sau:**
   - chế độ "chỉ ghi nhận" khi đổi một dòng chính sách;
   - ghi phiên bản bảng chính sách vào mỗi phiên;
   - chuyển sang Cedar.

## Hệ quả

**Được:**
- Bịt đường vòng qua lịch sử phiên.
- Một chỗ duy nhất để đọc và sửa chính sách.
- Quên hỏi bảng ở một đường mới thì test đỏ ngay.
- Bật "chia sẻ quyết định" sau này chỉ là sửa một ô trong bảng.

**Mất và rủi ro:**
- Agent con mất khả năng tự đọc lịch sử; agent chính phải trích đoạn khi giao việc.
- Thêm tool vào danh sách loại trừ là sửa file của chủ repo (spec 004), cần duyệt.
