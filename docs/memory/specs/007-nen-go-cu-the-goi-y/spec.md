# Spec 007: Nén hội thoại, gỡ memory cũ, thẻ gợi ý

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (07/11/2026, qua cổng 1 vòng 2). Plan qua cổng 2 (07/11/2026). Đã implement theo [tasks](tasks.md); chờ duyệt code trên PR #229 |
| **Ngày tạo** | 07/11/2026 |
| **Nhánh** | `feat/memory` |
| **Mô tả gốc** | "Ba việc: (1) toàn bộ phần nén hội thoại: mẫu tóm tắt chỉ giữ nhãn memory, không chép nội dung khối, nên xoá thì che được; mục "Ràng buộc và sở thích" của bản tóm tắt; báo memory lúc vừa nén; (2) gỡ memory cũ (lựa chọn "Memory cũ", tool `propose_memory`, hook "Ghi nhớ:"), có đường chuyển cho cấu hình cũ, không xoá dữ liệu người dùng; (3) thẻ gợi ý: tách thẻ khỏi câu trả lời, dòng thẻ trong file phiên, thẻ mở form của 003" (lộ trình `specs/README.md`, thứ tự 8) |
| **Dựa trên** | Vấn đề K3, K5; giải pháp §B3 mục 7, 8; kiến trúc v5.1 mục C2 (ai được đề xuất gì), C3 (file phiên: dòng thẻ; RAM: thẻ chưa duyệt), C4 bước 2, C5 bước 5 và 8, C11 (C-1 dòng thẻ, C-3 tách thẻ, C-7 nén) (`docs/memory/ra-soat-v5.md`); design-v5 §6 (thẻ v4) và §7 (hủy thẻ cũ, bản tóm tắt là lịch sử cũ); `design.md` §8.5 và L7; bảng chính sách `src/core/memory/policy.ts` (dòng `propose`); spec 001 YC-022, YC-026; spec 006 §8 (phần nén chuyển sang đây) |
| **Chốt trước khi viết (07/11/2026)** | Thẻ là một khối ở cuối câu trả lời, không phải tool. Loại thẻ: ràng buộc, cách trình bày, bài học. Cấu hình "Memory cũ" chuyển sang "Sổ ghi nhớ", báo một lần, không xoá file cũ. Việc 33b (memory kiểu Claude Code) được thay bằng Sổ ghi nhớ và thẻ gợi ý (§8) |

## 1. Bối cảnh và mục tiêu

Sau spec 006, sổ ghi nhớ chạy theo lịch sử thật và xoá thì che. Lộ trình còn ba việc:

| Việc | Ví dụ người dùng gặp hôm nay |
| --- | --- |
| **Bản tóm tắt chép nội dung memory** | Model đọc bài học #7 ở lượt 2. Hội thoại dài, app tự nén: bản tóm tắt ghi lại ý chính của #7 thành chữ thường, không nhãn. Người dùng xoá #7: khối #7 trong phần giữ lại bị che, nhưng câu chép trong bản tóm tắt vẫn được gửi ở mọi lượt sau |
| **Memory cũ vẫn là đường ghi của model** | Người dùng chọn "Memory cũ" và gõ "Ghi nhớ: không dùng margin". Hook lưu thẳng một mục, model gọi thêm `propose_memory` với gần đúng nội dung đó, `/memory` có hai mục trùng (việc 31a). Model có tool ghi memory, trái bất biến "chỉ người dùng ghi" |
| **Không có cách nào để model gợi ý lưu** | Người dùng nói "từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi". Model làm theo trong phiên, nhưng không có cách đề xuất lưu câu đó thành ràng buộc. Người dùng phải tự nhớ gõ `/nho` |

Spec này làm ba việc:

1. **Nén:** phần gửi cho model tóm tắt không còn nội dung khối memory, chỉ còn nhãn. Mẫu tóm tắt có mục "Ràng buộc và sở thích" ở cả hai bản. Lượt đầu sau nén có dòng nhắc cho model.
2. **Gỡ memory cũ:** bỏ lựa chọn "Memory cũ", tool `propose_memory` và hook "Ghi nhớ:". Cấu hình cũ chuyển sang Sổ ghi nhớ và được báo một lần; file cũ giữ nguyên.
3. **Thẻ gợi ý:** model có thể đề xuất lưu một ràng buộc, một cách trình bày hay một bài học bằng một khối ở cuối câu trả lời. Harness tách khối đó ra trước khi lưu lịch sử và hiện thành thẻ. Người dùng mở form của spec 003 để lưu, hoặc bỏ qua. Lượt sau model được báo kết quả.

Kết quả mong muốn:
- xoá một mục có hiệu lực cả với phần đã nén (C10 B9);
- model không còn đường nào làm memory có hiệu lực (bất biến 7); đề xuất của model chỉ thành memory sau khi người dùng xác nhận trong form;
- người dùng cũ của "Memory cũ" không mất dữ liệu và biết dữ liệu đó nằm ở đâu.

## 2. User story và kịch bản nghiệm thu

Ví dụ dùng chung, lấy từ kho mẫu của spec 002:
- chủ đề HPG có luận điểm bản 3, ghi 20/10/2026;
- bài học #3 "Quản trị rủi ro khi giải ngân", bài học #7 "Định giá ngân hàng" (bản 1);
- ràng buộc #1 "Không dùng margin, kể cả T+0".

Khối và dòng nhắc giữ định dạng của spec 002 và 006. Mọi kịch bản kiểm được bằng `bun test` với model giả, thư mục dữ liệu tạm, so trên request đã gửi, trên file phiên và trên giao diện headless.

### Story 1: Bản tóm tắt không chép nội dung memory (P1)

Hội thoại có khối memory bị nén. Người dùng muốn bản tóm tắt không mang theo nội dung memory, để xoá hay sửa một mục sau đó vẫn có hiệu lực, và model vẫn biết phải đọc lại memory khi cần.

- **Vì sao ưu tiên này:** đây là giới hạn cuối cùng còn mở của lộ trình. Bản tóm tắt là chữ không nhãn, nên spec 006 không che tới được.
- **Kiểm độc lập:** tạo phiên có khối HPG bản 3 ở phần nhắc nhở và khối #7 (chứa chuỗi đánh dấu `DANHDAU-7`) trong kết quả `memory_read`, ở phần sẽ được tóm tắt; nén thành công với model giả; xem request tóm tắt.

**Kịch bản nghiệm thu:**

1. **Cho** phần sẽ tóm tắt có khối #7 trong kết quả `memory_read` và khối HPG bản 3 trong phần nhắc nhở,
   **khi** app nén hội thoại (tự động hay `/compact`),
   **thì:**
   - request tóm tắt không chứa `DANHDAU-7` hay nội dung luận điểm HPG ở bất kỳ đâu;
   - mỗi chỗ có khối cũ còn đúng dòng nhãn của khối đó, kèm câu "nội dung đã lược khỏi bản tóm tắt";
   - phần còn lại của kết quả tool và tin nhắn giữ nguyên.
2. **Cho** như kịch bản 1,
   **khi** nén,
   **thì** request tóm tắt không có mục lục sổ ghi nhớ (khối `[Sổ ghi nhớ · mục lục …]`).
3. **Cho** như kịch bản 1, nén xong, rồi người dùng xoá #7,
   **khi** lượt kế tiếp gửi,
   **thì** request không chứa `DANHDAU-7` ở bất kỳ đâu (cả bản tóm tắt lẫn phần giữ lại).
4. **Cho** phần sẽ tóm tắt có một câu người dùng gõ chứa chữ giống nhãn `[Memory · bài học · #7 …]`,
   **khi** nén,
   **thì** câu đó được gửi nguyên văn (chỉ khối trong hai kênh của memory bị lược, như spec 006 YC-002).
5. **Cho** một khối bị lõi cắt ngắn (dấu cắt kết quả tool),
   **khi** nén,
   **thì** phần còn lại của khối đó cũng bị lược, chỉ còn dòng nhãn.
6. **Cho** sổ ghi nhớ đang tắt, và phần sẽ tóm tắt có khối memory từ lúc sổ còn bật,
   **khi** nén,
   **thì** các khối vẫn bị lược như kịch bản 1.

### Story 2: Bản tóm tắt giữ ràng buộc và sở thích người dùng nói trong chat (P1)

Người dùng nói trong chat "tôi chỉ đầu tư dài hạn, trên một năm" mà không lưu bằng `/nho`. Hội thoại rất dài nên bị nén bằng bản rút gọn. Họ muốn sau nén model vẫn nhớ điều đó.

- **Vì sao ưu tiên này:** bản rút gọn hiện bỏ mục "Ràng buộc và sở thích" (`design.md` §8.5, L7), nên phiên rất dài mất đúng loại thông tin người dùng quan tâm nhất.
- **Kiểm độc lập:** so nội dung mẫu tóm tắt hai bản.

**Kịch bản nghiệm thu:**

1. **Cho** phần sẽ tóm tắt đủ dài để dùng bản rút gọn,
   **khi** nén,
   **thì** mẫu tóm tắt có mục "Ràng buộc và sở thích", định nghĩa là "điều người dùng đã nói trong hội thoại này".
2. **Cho** bản đầy đủ hay bản rút gọn,
   **khi** nén,
   **thì** mẫu dặn: không chép nội dung khối memory hay ràng buộc đã lưu; nhắc tới thì ghi nhãn (ví dụ "bài học #7"); ràng buộc đã lưu được gửi lại ở mọi request nên không cần chép.
3. **Cho** người dùng thêm hướng dẫn `/compact giữ phần định giá`,
   **khi** nén,
   **thì** hướng dẫn thêm vẫn đứng cuối mẫu như hiện nay.

### Story 3: Lượt đầu sau nén, model biết memory phải đọc lại (P1)

Sau nén, các khối memory trong phần đã tóm tắt không còn. Người dùng hỏi tiếp về HPG. Họ muốn model có luận điểm HPG bản hiện hành, và biết rằng nội dung memory phía trên đã được lược.

- **Kiểm độc lập:** nén, gửi lượt kế tiếp, so request.

**Kịch bản nghiệm thu:**

1. **Cho** vừa nén xong,
   **khi** lượt đầu sau nén gửi,
   **thì** phần nhắc nhở có dòng `[Memory · nhắc] Hội thoại phía trên đã được nén; bản tóm tắt chỉ giữ nhãn memory, cần nội dung thì đọc bằng memory_read.`, đúng một lần cho mỗi lần nén.
2. **Cho** HPG đang là chủ đề được bàn và khối HPG chỉ nằm trong phần đã tóm tắt, rồi luận điểm HPG được lưu bản 4 trước khi nén,
   **khi** lượt đầu sau nén hỏi tiếp "điều kiện thứ hai thì sao?",
   **thì** lượt đó có khối HPG bản 4 (bản hiện hành), không có "thay cho bản 3".
3. **Cho** vừa nén xong,
   **khi** lượt đầu sau nén gửi,
   **thì** mục lục được dựng lại theo kho hiện tại (mục thêm từ đầu phiên đã nằm trong mục lục, không còn dòng nhắc "Sổ có thêm …" cho chúng).
4. **Cho** sổ ghi nhớ đang tắt,
   **khi** lượt đầu sau nén gửi,
   **thì** không có dòng nhắc nén nào.
5. **Cho** lần nén chỉ dọn kết quả tool cũ, không có bản tóm tắt,
   **khi** lượt kế tiếp gửi,
   **thì** không có dòng nhắc nén.
6. **Cho** hai lần nén gần nhau, dòng nhắc của lần nén thứ nhất nằm trong phần giữ lại của lần thứ hai,
   **khi** lượt đầu sau lần nén thứ hai gửi,
   **thì** vẫn có dòng nhắc nén cho lần thứ hai.

### Story 4: Gỡ memory cũ, người dùng cũ không mất dữ liệu (P1)

Người dùng đang chọn "Memory cũ" cập nhật lên bản mới. Họ muốn app vẫn chạy, biết memory cũ đi đâu, và không mất ghi chú cũ.

- **Vì sao ưu tiên này:** memory cũ cho model một tool ghi (`propose_memory`) và một hook lưu thẳng, trái bất biến 7, và gây lỗi lưu trùng 31a.
- **Kiểm độc lập:** cấu hình mẫu `{"memory":{"provider":"file"}}` và thư mục `memory/` có vài file; khởi động app.

**Kịch bản nghiệm thu:**

1. **Cho** cấu hình có `"provider": "file"` và thư mục `memory/` có 3 file,
   **khi** app khởi động,
   **thì:**
   - cấu hình được ghi lại thành `"notebook"` và Sổ ghi nhớ mở như người dùng tự chọn;
   - giao diện hiện một câu báo: memory cũ đã gỡ, ghi chú cũ vẫn nằm ở `<đường dẫn thư mục memory>`, chép sang bằng `/nho` (ràng buộc, cách trình bày) hoặc `/baihoc`;
   - 3 file trong `memory/` không đổi byte nào.
2. **Cho** như kịch bản 1, app đã khởi động một lần,
   **khi** app khởi động lần nữa,
   **thì** không có câu báo nào.
3. **Cho** cấu hình có `"provider": "file"`,
   **khi** chạy dòng lệnh không giao diện (`ot` một câu hỏi) hoặc bộ chạy đo,
   **thì** chạy không lỗi; hai đường này vẫn không dùng memory như hiện nay; cấu hình **không** bị ghi lại và không có câu báo.
4. **Cho** như kịch bản 3, sau đó mở giao diện lần đầu,
   **khi** app khởi động,
   **thì** câu báo vẫn hiện đúng một lần và cấu hình được ghi lại như kịch bản 1.
5. **Cho** bất kỳ lựa chọn memory nào,
   **khi** model nhận danh sách tool,
   **thì** không có `propose_memory`; tin nhắn bắt đầu bằng "Ghi nhớ:" được gửi như mọi tin nhắn, không có gì được lưu.
6. **Cho** `/config`,
   **khi** mở mục memory (kể cả khi cấu hình còn `"file"` chưa được ghi lại),
   **thì** chỉ còn "Tắt" và "Sổ ghi nhớ", và "Sổ ghi nhớ" được đánh dấu đang chọn.
7. **Cho** memory đang tắt,
   **khi** mở `/memory`,
   **thì** màn "memory đang tắt" vẫn hiện như hiện nay.

### Story 5: Model gợi ý lưu, người dùng quyết định (P2)

Người dùng nói "từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi". Họ muốn model trả lời bình thường, và dưới câu trả lời có một thẻ gợi ý lưu câu đó thành ràng buộc. Họ bấm Enter, form `/nho` mở sẵn câu đó, họ chọn loại rồi Xác nhận.

- **Vì sao ưu tiên này:** thẻ là đường duy nhất còn lại để model đề xuất memory (`/memory quet` đã bỏ, memory cũ bị gỡ). Không có thẻ thì sổ vẫn dùng được đủ, nên P2.
- **Kiểm độc lập:** model giả trả câu trả lời có khối thẻ ở cuối; xem màn hình, lịch sử, file phiên, kho.

**Kịch bản nghiệm thu:**

1. **Cho** người dùng gõ "từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi", và câu trả lời cuối của model kết thúc bằng khối thẻ loại ràng buộc, trích đúng câu đó,
   **khi** lượt kết thúc,
   **thì:**
   - giao diện hiện câu trả lời không có khối thẻ, và một thẻ dưới câu trả lời: "Gợi ý lưu · ràng buộc", câu ràng buộc model đề xuất, câu gốc người dùng gõ đặt cạnh để đối chiếu, phím Enter mở form, `x` bỏ qua;
   - lịch sử (cả lượt này lẫn các lượt sau) không chứa khối thẻ;
   - file phiên có một dòng thẻ trạng thái "chờ";
   - kho không có gì mới.
2. **Cho** như kịch bản 1, thẻ đang được chọn,
   **khi** người dùng bấm Enter,
   **thì** form `/nho` mở, ô nội dung điền sẵn câu ràng buộc model đề xuất ("Không gợi ý cổ phiếu penny"), câu gốc người dùng gõ hiện bên dưới để đối chiếu, loại chưa chọn sẵn (như spec 003: ràng buộc hay cách trình bày do người dùng chọn).
3. **Cho** form đang mở từ thẻ,
   **khi** người dùng bấm Xác nhận,
   **thì** kho có ràng buộc mới với nguồn "từ thẻ gợi ý", thẻ chuyển "đã lưu", file phiên có dòng thẻ "đã lưu".
4. **Cho** form đang mở từ thẻ,
   **khi** người dùng đóng form không lưu,
   **thì** thẻ vẫn "chờ", kho không đổi.
5. **Cho** thẻ đang được chọn,
   **khi** người dùng bấm `x`,
   **thì** thẻ chuyển "đã bỏ qua", file phiên có dòng thẻ "đã bỏ qua", kho không đổi.
6. **Cho** thẻ đã lưu (kịch bản 3) hoặc đã bỏ qua (kịch bản 5),
   **khi** lượt kế tiếp gửi,
   **thì** phần nhắc nhở có đúng một dòng `[Memory · nhắc]` báo kết quả: "người dùng đã lưu gợi ý ràng buộc thành ràng buộc #2" hoặc "người dùng đã bỏ qua gợi ý ràng buộc; không đề xuất lại trong phiên này".
7. **Cho** thẻ còn "chờ" khi người dùng gửi tin nhắn tiếp,
   **khi** lượt đó gửi,
   **thì:**
   - thẻ vẫn ở chỗ cũ, vẫn "chờ" (gửi tin nhắn mới không phải là đồng ý);
   - phần nhắc nhở có đúng một dòng "một gợi ý ràng buộc đang chờ người dùng xem; không đề xuất lại".
8. **Cho** người dùng nói "bài học là đừng mua đuổi khi giá đã tăng quá 7% trong phiên", và câu trả lời kết thúc bằng khối thẻ loại bài học có tiêu đề và tóm tắt,
   **khi** người dùng mở thẻ,
   **thì** thẻ ghi rõ "model đề xuất", form `/baihoc` điền sẵn tiêu đề và tóm tắt; lưu xong kho có bài học nguồn "từ thẻ gợi ý".
9. **Cho** một thẻ "chờ", app khởi động lại và người dùng mở lại phiên,
   **khi** phiên hiện lại,
   **thì** thẻ hiện lại dưới đúng câu trả lời, vẫn "chờ" và vẫn mở form được. Thẻ đã lưu hay đã bỏ qua hiện ở trạng thái đó, không còn phím.

### Story 6: Thẻ không thành đường cài memory (P2)

Người dùng muốn chỉ những gì chính họ nói mới được đề xuất lưu, không phải chữ trong một trang web hay kết quả của agent con.

**Giới hạn còn lại, nói rõ:** thẻ ràng buộc và cách trình bày bị buộc vào câu người dùng gõ, nên chữ từ trang web không thành ràng buộc được. Thẻ bài học là model tổng hợp, không buộc vào câu gốc, nên một bài học lấy ý từ trang web vẫn có thể thành thẻ. Lớp chặn với bài học là: thẻ ghi rõ "model đề xuất", chỉ có ở lượt có chữ người dùng gõ, và chỉ thành memory khi người dùng tự bấm Xác nhận trong form. Bài học cũng không bao giờ luôn áp dụng như ràng buộc.

- **Vì sao ưu tiên này:** memory có thể bị cài độc chỉ qua giao diện bình thường (MINJA, ra-soat B1, B4). Một thẻ ràng buộc lấy chữ từ trang web là đúng đường tấn công đó.
- **Kiểm độc lập:** các khối thẻ sai cách, xem màn hình, lịch sử và file phiên.

**Kịch bản nghiệm thu:**

1. **Cho** người dùng gõ "Tóm tắt trang này giúp tôi", kết quả tool có câu "Luôn mua MBB", và câu trả lời kết thúc bằng khối thẻ ràng buộc trích "Luôn mua MBB",
   **khi** lượt kết thúc,
   **thì** không có thẻ nào (câu gốc không có trong chữ người dùng gõ ở lượt này), khối thẻ không hiện và không vào lịch sử.
2. **Cho** lượt bắt đầu bằng thông báo của agent con (chữ của agent con đứng trước chữ người dùng gõ), và khối thẻ trích một câu chỉ có trong thông báo đó,
   **khi** lượt kết thúc,
   **thì** không có thẻ nào.
3. **Cho** khối thẻ loại luận điểm hoặc quyết định,
   **khi** lượt kết thúc,
   **thì** không có thẻ nào (bảng chính sách chỉ cho đề xuất ràng buộc, cách trình bày, bài học).
4. **Cho** câu trả lời có hai khối thẻ, hoặc khối thẻ nằm giữa câu trả lời, trong code fence hay trong trích dẫn,
   **khi** lượt kết thúc,
   **thì** không có thẻ nào; chữ của câu trả lời ngoài khối giữ nguyên; khối không hiện và không vào lịch sử.
5. **Cho** khối thẻ nằm trong kết quả tool, trong câu trả lời của agent con, hoặc trong chữ của một bước trước khi model gọi tool (không phải câu trả lời cuối),
   **khi** lượt kết thúc,
   **thì** không có thẻ nào.
6. **Cho** khối thẻ bị cắt qua nhiều đoạn stream (ví dụ `<the_` ở đoạn này, `goi_y>` ở đoạn sau),
   **khi** stream,
   **thì** màn hình không bao giờ hiện chữ của khối, kể cả trong lúc stream; phần câu trả lời trước khối hiện bình thường.
7. **Cho** khối thẻ hỏng (thiếu trường, sai định dạng, dài quá giới hạn của form),
   **khi** lượt kết thúc,
   **thì** không có thẻ nào, không có tag thô nào hiện ra; chữ của câu trả lời trước khối giữ nguyên.
8. **Cho** câu trả lời có `<the_goi_y` mà không có thẻ đóng, và sau đó model còn viết tiếp câu trả lời,
   **khi** stream kết thúc,
   **thì** không có thẻ; phần chữ sau dòng mở khối được hiện và lưu như câu trả lời bình thường (chỉ bỏ dòng mở khối), không mất chữ nào của câu trả lời và không có tag thô. Chữ bị giữ lại trong lúc chờ thẻ đóng cũng được thả ra khi vượt quá giới hạn độ dài của khối thẻ.
9. **Cho** khối thẻ trùng một thẻ "chờ" hay "đã bỏ qua" trong phiên này (cùng loại, cùng nội dung sau khi chuẩn hoá),
   **khi** lượt kết thúc,
   **thì** không có thẻ mới.

### Story 7: Người dùng tắt thẻ được (P3)

Người dùng thấy thẻ phiền, hoặc dùng model nhỏ hay sinh khối thẻ sai. Họ muốn tắt thẻ mà vẫn dùng sổ ghi nhớ.

**Kịch bản nghiệm thu:**

1. **Cho** `/config` mục memory, Sổ ghi nhớ đang bật,
   **khi** người dùng tắt "Cho phép thẻ gợi ý",
   **thì** từ lượt sau phần hướng dẫn của sổ không còn đoạn hướng dẫn tạo thẻ, và khối thẻ nếu có bị bỏ như kịch bản Story 6.7.
2. **Cho** model đang dùng thuộc hạng C (ngữ cảnh dưới 64k),
   **khi** gửi lượt,
   **thì** không có hướng dẫn tạo thẻ, dù công tắc bật (design-v5 §6: model nhỏ tạo tag kém).
3. **Cho** dòng lệnh không giao diện,
   **khi** model trả câu trả lời,
   **thì** không có hướng dẫn tạo thẻ và không có thẻ (không có nơi để người dùng duyệt; design-v5 §6 "headless không tự xác nhận").
4. **Cho** `/memory` của Sổ ghi nhớ,
   **khi** mở,
   **thì** đầu màn có dòng trạng thái "Thẻ gợi ý: bật" hoặc "tắt", kèm cách đổi.

### Story 8: Người dùng bảo bỏ qua memory (P3)

Người dùng nói "trả lời câu này đừng dùng memory của tôi". Họ muốn câu trả lời đó không dựa vào luận điểm hay bài học đã lưu.

**Kịch bản nghiệm thu:**

1. **Cho** phần hướng dẫn của sổ ghi nhớ,
   **khi** gửi bất kỳ lượt nào,
   **thì** hướng dẫn có luật: người dùng bảo bỏ qua memory thì trả lời như không có luận điểm, bài học hay cách trình bày đã lưu; ràng buộc vẫn áp dụng (ràng buộc là luật của người dùng, không phải gợi ý).

## 3. Tình huống biên và lỗi

**Nén:**
- **Khối nằm ở phần giữ lại** (không tóm tắt) giữ nguyên, như hiện nay.
- **Tạm che trước khi nén.** Khối đang tạm che (kho không đọc được, spec 006 YC-010) nằm ở phần sẽ tóm tắt thì bị lược như mọi khối. Khối đang tạm che ở **phần giữ lại** thì giữ như hiện nay: dòng nén lưu phần giữ lại đã tạm che, nên chỗ đó thành che vĩnh viễn (người dùng chốt 07/11/2026). Lý do: phần giữ lại chỉ là vài lượt cuối, kho lỗi đúng lúc nén là ca hiếm, model vẫn đọc lại được bằng `memory_read` và khối của chủ đề đang bàn được chèn lại.
- **Nén lần hai.** Bản tóm tắt cũ nằm ở phần sẽ tóm tắt; nó không có nội dung memory (đã lược từ lần trước), nên không cần lược thêm.
- **Bản tóm tắt nhắc nội dung câu trả lời cũ của model** đã nói lại ý của một mục: không có nhãn để nhận ra, như spec 006 §8 (che chữ trong câu trả lời). Câu báo xoá đã nói bản sao cũ có thể còn.
- **Nén bị dừng, bị lỗi, bản tóm tắt bị cắt:** lịch sử giữ nguyên như hiện nay; không có dòng nhắc nén.
- **Lần nén chỉ dọn kết quả tool** (không có bản tóm tắt): không có dòng nhắc nén (Story 3 kịch bản 5).
- **Ràng buộc đã lưu trong request tóm tắt.** Request tóm tắt **không** có khối `rang_buoc` (người dùng chốt 07/11/2026). Ràng buộc vẫn gửi ở phần hệ thống của mọi request thường, nên sau nén không mất gì; bản tóm tắt không bao giờ giữ chữ cũ của một ràng buộc người dùng sửa hay xoá sau đó. Đổi có chủ đích kỳ vọng của test spec 005 về request tóm tắt.

**Gỡ memory cũ:**
- **Thư mục `memory/` không có hoặc rỗng:** cấu hình vẫn chuyển, câu báo không nói tới file cũ.
- **Ghi lại cấu hình lỗi** (file khoá, ổ đầy): app vẫn dùng Sổ ghi nhớ trong lần chạy đó, báo lỗi ghi một lần; lần sau thử ghi lại.
- **Kho `memory.db` không mở được** khi chuyển: như mọi lần bật Sổ lỗi hiện nay (báo lỗi mở kho lúc khởi động).
- **Giá trị cấu hình lạ** (không phải `"none"`, `"notebook"`, `"file"`): như hiện nay, coi là tắt.

**Thẻ:**
- **Câu gốc.** So sau khi chuẩn hoá khoảng trắng và dạng Unicode (NFC); không phân biệt hoa thường; không bỏ dấu. Thẻ ràng buộc và cách trình bày phải có câu gốc khớp một đoạn liền trong chữ người dùng gõ ở lượt này (đã bỏ thông báo agent con, ultradesk). Thẻ bài học là model tổng hợp nên không bắt câu gốc, nhưng chỉ được tạo ở lượt có chữ người dùng gõ.
- **Lượt không có chữ người dùng gõ** (lượt chỉ có thông báo, lượt app tự gửi như "tiếp tục sau khi nén", lượt do prompt MCP viết): không có thẻ.
- **Lượt cứu do câu trả lời bị cắt vì dài** (model được nhắc trả lời tiếp): khối thẻ chỉ được xét trên câu trả lời cuối đã ghép; nếu khối bị cắt ngang thì bỏ.
- **Lượt bị dừng giữa chừng** (Esc) hoặc lỗi: không có thẻ.
- **Kho đã đổi khi bấm thẻ.** Thẻ chỉ đề xuất mục mới, không sửa mục có sẵn, nên không có ca "thẻ cũ ghi đè mục mới" (`ra-soat-v5.md`, ví dụ "sửa #7 bản 1" sau khi #7 bị xoá; design-v5 §7 "hủy thẻ cũ nhắm vào revision đã đổi"). Form của spec 003 vẫn cảnh báo trùng như khi người dùng tự gõ.
- **Sổ ghi nhớ bị tắt khi thẻ đang chờ:** thẻ vẫn hiện, bấm Enter thì báo "Sổ ghi nhớ đang tắt" như `/nho` hiện nay; thẻ vẫn "chờ".
- **Ghi dòng thẻ lỗi:** đi qua bộ ghi phiên của spec 004 như mọi dòng khác (lưu bù, biên nhận). Thẻ trên màn hình không phụ thuộc vào việc ghi thành công.
- **Nhiều cửa sổ cùng phiên:** như spec 004, không hỗ trợ cùng ghi tiếp một phiên.
- **Nén khi có thẻ chờ:** thẻ là dòng chỉ ghi nhật ký, không nằm trong lịch sử nên không bị nén; dòng nhắc "đang chờ" đã nằm trong phần bị tóm tắt có thể được nói lại một lần.

## 4. Yêu cầu

### Yêu cầu chức năng

**Nén hội thoại**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-001 | Trước khi gửi phần sẽ tóm tắt cho model, app PHẢI thay mỗi khối memory trong hai kênh của memory (phần nhắc nhở memory, kết quả `memory_read`) bằng dòng nhãn của khối kèm câu "nội dung đã lược khỏi bản tóm tắt". Áp dụng cả khi sổ đang tắt. Chữ ngoài hai kênh không bị đụng | §B3 mục 8, C11 (C-7); spec 006 YC-002 |
| YC-002 | Request tóm tắt KHÔNG được có mục lục sổ ghi nhớ | §B3 mục 8; bài học opencode |
| YC-003 | Request tóm tắt KHÔNG được có khối `rang_buoc`; mọi request thường vẫn có (spec 005) | C10 B9; người dùng chốt 07/11/2026 |
| YC-004 | Mẫu tóm tắt cả bản đầy đủ lẫn bản rút gọn PHẢI có mục "Ràng buộc và sở thích", định nghĩa là điều người dùng đã nói trong hội thoại này | `design.md` §8.5, L7 |
| YC-005 | Mẫu tóm tắt PHẢI dặn không chép nội dung khối memory hay ràng buộc đã lưu, nhắc tới thì ghi nhãn | §B3 mục 8; design-v5 §7 |
| YC-006 | Lượt đầu sau mỗi lần nén có bản tóm tắt, khi sổ ghi nhớ bật, PHẢI có đúng một dòng nhắc nén (Story 3 kịch bản 1, 6). Dòng nhắc so theo lịch sử như mọi dòng nhắc khác (spec 006 YC-004), nhưng phân biệt từng lần nén, để dòng nhắc của lần nén trước không chặn dòng nhắc của lần sau | C11 (C-7) "báo memory lúc vừa nén" |
| YC-007 | Sau một lần nén, mục lục PHẢI được dựng lại theo kho ở request kế tiếp | §B3 mục 8 |
| YC-008 | Sau nén, khối của chủ đề đang được bàn mà không còn trong lịch sử PHẢI được chèn lại ở bản hiện hành (hành vi hiện có của spec 006, giữ và có test) | §B3 mục 8 |

**Gỡ memory cũ**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-009 | App KHÔNG được còn lựa chọn "Memory cũ", tool `propose_memory` hay hook lưu câu "Ghi nhớ:" | Bất biến 7; lộ trình 007 (2); việc 31a |
| YC-010 | Cấu hình `"provider": "file"` PHẢI được hiểu là `"notebook"` ở mọi chỗ đọc cấu hình memory, không lỗi. Chỉ lúc giao diện khởi động mới ghi lại thành `"notebook"`; các đường khác chỉ hiểu, không ghi | Lộ trình 007 (2) "đường chuyển cho cấu hình cũ" |
| YC-011 | Ghi lại cấu hình và câu báo đi cùng một bước lúc giao diện khởi động: câu báo duy nhất có đường dẫn thư mục memory cũ (nếu có file) và cách chép sang; không hiện lại ở lần khởi động sau, kể cả khi dòng lệnh không giao diện đã chạy trước đó | Lộ trình 007 (2) |
| YC-012 | App KHÔNG được xoá, sửa hay di chuyển file trong thư mục memory cũ | Lộ trình 007 (2) "không xoá dữ liệu người dùng" |
| YC-013 | Màn "memory đang tắt" của `/memory` PHẢI giữ nguyên | Spec 002 |
| YC-014 | Hợp đồng `MemoryProvider` PHẢI bỏ các phần chỉ memory cũ dùng: trạng thái `pending`, `approve`, `reject` và quy định "pending không trả về". Thẻ gợi ý không đi qua kho nên không cần trạng thái chờ duyệt trong hợp đồng | `docs/contracts.md` §6; spec 001 YC-022; người dùng chốt 07/11/2026 |

**Thẻ gợi ý: tạo và tách**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-015 | Khi thẻ được bật (YC-031), hướng dẫn của sổ ghi nhớ PHẢI mô tả khối thẻ: khi nào đề xuất (người dùng nói ra một luật, cách trình bày hay bài học bền vững ở lượt này), không đề xuất gì (số liệu, giá, mã tài khoản, bí mật, việc chỉ của phiên này, điều đã có trong sổ), định dạng, tối đa một thẻ | C5 bước 8; design-v5 §6 |
| YC-016 | App PHẢI chỉ nhận một khối thẻ hợp lệ duy nhất đứng ở cuối câu trả lời cuối của agent chính. Khối ở nơi khác (giữa câu trả lời, code fence, trích dẫn, kết quả tool, agent con, chữ của bước có gọi tool) hoặc có hai khối thì không có thẻ | design-v5 §6 |
| YC-017 | Khối thẻ (hợp lệ hay không) PHẢI bị tách khỏi câu trả lời trước khi vào lịch sử và KHÔNG được hiện ra màn hình, kể cả lúc stream và khi khối bị cắt qua nhiều đoạn stream. Phần câu trả lời ngoài khối giữ nguyên. Khối không có thẻ đóng thì không được nuốt chữ phía sau: hết stream hoặc vượt giới hạn độ dài của khối thì chữ đang giữ được thả ra, chỉ bỏ dòng mở khối (Story 6 kịch bản 8) | §B3 mục 7, C11 (C-3); design-v5 §6 "không che mất phần trả lời hợp lệ sau một tag lỗi" |
| YC-018 | Loại thẻ PHẢI là một trong ràng buộc, cách trình bày, bài học, và PHẢI được bảng chính sách cho phép đề xuất. Loại khác thì không có thẻ | `policy.ts` (`propose`); C2; spec 001 YC-026 |
| YC-019 | Thẻ ràng buộc và cách trình bày PHẢI có câu gốc khớp một đoạn liền trong chữ người dùng gõ ở lượt đó (§3); không khớp thì không có thẻ | C4 bước 2; C2 "Thẻ (phải có câu gốc)"; B4 bước 1 |
| YC-020 | Lượt không có chữ người dùng gõ, lượt bị dừng hay lỗi, dòng lệnh không giao diện: không có thẻ | B4; design-v5 §6 |
| YC-021 | Khối thẻ trùng một thẻ "chờ" hoặc "đã bỏ qua" của phiên này thì không có thẻ mới | Thẻ bị tách khỏi lịch sử nên model không thấy đề xuất cũ của chính nó; bài học Claude Code (`memory_saved` không báo model, nên model đề xuất lại) |
| YC-022 | Nội dung thẻ PHẢI qua đúng giới hạn độ dài và kiểm chuỗi giống khoá API của form spec 003; quá giới hạn hay giống khoá thì không có thẻ | Spec 001 (giới hạn, từ chối khoá); design-v5 §6 |

**Thẻ gợi ý: duyệt**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-023 | Thẻ PHẢI hiện dưới câu trả lời: loại, nội dung, câu gốc (ràng buộc, cách trình bày) hoặc chữ "model đề xuất" (bài học), phím Enter mở form, `x` bỏ qua. Phím chỉ có tác dụng khi thẻ đang được chọn; gửi tin nhắn mới không phải là đồng ý | design-v5 §6 |
| YC-024 | Enter PHẢI mở đúng form spec 003 của loại thẻ, điền sẵn nội dung model đề xuất (ràng buộc, cách trình bày: câu đề xuất; bài học: tiêu đề, tóm tắt); thẻ ràng buộc và cách trình bày hiện câu gốc trong form để đối chiếu. Form ràng buộc không chọn sẵn loại (ràng buộc hay cách trình bày) như spec 003 | Lộ trình 007 (3); spec 003; design-v5 §6 "rule card cần cho xem đoạn user gốc" |
| YC-025 | Thẻ KHÔNG được ghi gì vào kho cho tới khi người dùng bấm Xác nhận trong form. Mục lưu từ thẻ có nguồn "từ thẻ gợi ý" | Spec 001 YC-022; bất biến 7 |
| YC-026 | Thẻ có ba trạng thái: chờ, đã lưu, đã bỏ qua. Lưu thành công thì "đã lưu"; `x` thì "đã bỏ qua"; đóng form không lưu thì vẫn "chờ" | C3 (dòng thẻ) |

**Thẻ gợi ý: ghi và báo**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-027 | File phiên PHẢI có dòng thẻ (model không thấy) khi thẻ được tạo và mỗi khi đổi trạng thái; dòng sau cùng của một thẻ là trạng thái của nó. Dòng thẻ đi qua bộ ghi phiên của spec 004, chỉ nối thêm. Bản app cũ đọc file có dòng thẻ không lỗi | C3; C11 (C-1); spec 004 |
| YC-028 | Mở lại phiên PHẢI hiện lại thẻ ở đúng chỗ với trạng thái cuối; thẻ "chờ" vẫn dùng được | C3 (RAM: thẻ chưa duyệt) |
| YC-029 | Lượt kế tiếp sau khi thẻ đổi trạng thái PHẢI có đúng một dòng nhắc báo kết quả; lượt kế tiếp khi thẻ vẫn "chờ" PHẢI có đúng một dòng nhắc "đang chờ, không đề xuất lại". Dòng nhắc không chứa nội dung thẻ ngoài loại và số mục đã lưu | §B3 mục 7; C5 bước 5 |
| YC-030 | Dòng thẻ và dòng nhắc KHÔNG được chứa nội dung quyết định | C10 B3 |

**Công tắc và luật dùng**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-031 | `/config` mục memory PHẢI có công tắc "Cho phép thẻ gợi ý", mặc định bật, chỉ có tác dụng khi Sổ ghi nhớ bật. Model hạng C không có hướng dẫn tạo thẻ dù công tắc bật | design-v5 §6; bài học Codex (dùng và tạo tách riêng) |
| YC-032 | `/memory` của Sổ ghi nhớ PHẢI hiện trạng thái công tắc thẻ | Bài học Claude Code (`/memory` có công tắc) |
| YC-033 | Hướng dẫn của sổ ghi nhớ PHẢI có luật "người dùng bảo bỏ qua memory" (Story 8) | Đối chiếu 33b (§8) |

### Thực thể chính

- **Khối thẻ:** chữ có cấu trúc model viết ở cuối câu trả lời: loại; nội dung đề xuất theo loại (ràng buộc, cách trình bày: một câu model viết gọn; bài học: tiêu đề, tóm tắt); câu gốc người dùng gõ (ràng buộc, cách trình bày; để đối chiếu và để kiểm YC-019). Không bao giờ vào lịch sử.
- **Thẻ:** thứ người dùng thấy và bấm; có mã trong phiên, mã lượt, loại, nội dung, câu gốc, trạng thái.
- **Dòng thẻ:** một dòng trong file phiên, model không thấy: mã thẻ, mã lượt, loại, nội dung, câu gốc, trạng thái, số mục đã lưu (khi đã lưu).
- **Dòng nhắc nén, dòng nhắc thẻ:** dòng `[Memory · nhắc]` kiểu mới, đi cùng các dòng nhắc của spec 002 và 006.
- **Câu báo chuyển memory cũ:** một dòng trên giao diện, không vào lịch sử.

## 5. Tiêu chí thành công

| Mã | Tiêu chí đo được | Kiểm bằng |
| --- | --- | --- |
| TC-001 | Story 1 kịch bản 1–6: nén **thành công** với model giả; request tóm tắt không chứa chuỗi đánh dấu của khối nào, không có mục lục; dòng nhãn còn đúng chỗ; chữ giống nhãn ngoài hai kênh giữ nguyên; xoá sau nén thì không request nào chứa chuỗi đánh dấu | `bun test` |
| TC-002 | Story 2: mẫu tóm tắt hai bản có mục "Ràng buộc và sở thích" và câu dặn về nhãn memory (đổi có chủ đích một kỳ vọng ở test nén hiện có) | `bun test` |
| TC-003 | Story 3 kịch bản 1–6 (gồm hai lần nén gần nhau): dòng nhắc nén đúng một lần mỗi lần nén, không có khi sổ tắt hay khi chỉ dọn kết quả tool; khối HPG bản hiện hành sau nén; mục lục dựng lại | `bun test` |
| TC-004 | Story 4 kịch bản 1–7 (gồm chạy dòng lệnh trước rồi mới mở giao diện): cấu hình `"file"` chuyển và ghi lại; câu báo đúng một lần; file cũ không đổi byte nào (so trước, sau); dòng lệnh không giao diện dùng Sổ; không có `propose_memory`; `/config` hai lựa chọn; `/memory` khi tắt | `bun test` (gồm giao diện headless) |
| TC-005 | Story 5 kịch bản 1–9: thẻ hiện, khối thẻ không có trong lịch sử và trên màn hình; Enter mở form điền sẵn; Xác nhận lưu với nguồn "từ thẻ gợi ý"; `x` bỏ qua; đóng form vẫn "chờ"; dòng nhắc kết quả và "đang chờ" đúng một lần; mở lại phiên hiện lại thẻ | `bun test` (gồm giao diện headless) |
| TC-006 | Story 6 kịch bản 1–9: không có thẻ trong mọi ca sai; không ca nào hiện chữ của khối thẻ ra màn hình, kể cả khi khối bị cắt qua từng ký tự một của stream; khối không có thẻ đóng không làm mất chữ phía sau (so câu trả lời hiện ra và lưu với câu trả lời gốc bỏ dòng mở khối) | `bun test` |
| TC-007 | Story 7, 8: công tắc tắt và hạng C thì không có hướng dẫn tạo thẻ; dòng lệnh không giao diện không có thẻ; `/memory` hiện trạng thái; hướng dẫn có luật bỏ qua memory | `bun test` |
| TC-008 | Tương thích: file phiên có dòng thẻ đọc được bằng bộ đọc bản trước; phiên ghi trước spec này mở lại không đổi | `bun test` |
| TC-009 | Không request, dòng thẻ, dòng nhắc nào chứa nội dung quyết định (chuỗi đánh dấu trong lý do quyết định) | `bun test` |
| TC-010 | Typecheck sạch; toàn bộ `bun test` xanh ở máy (Windows, Linux) và trên CI; test hiện có chỉ đổi kỳ vọng ở chỗ spec này đổi hành vi (mẫu tóm tắt rút gọn, memory cũ bị gỡ, số tool) | `bun run typecheck`, `bun test`, CI |

## 6. Đối chiếu bất biến

| Bất biến | Spec giữ thế nào |
| --- | --- |
| Chỉ đọc | Không thêm tool; bỏ `propose_memory`. Model chỉ còn `memory_read` |
| Quyền do code quyết định | Thẻ chỉ có khi bảng chính sách cho đề xuất loại đó (YC-018) và câu gốc khớp chữ người dùng gõ (YC-019), do code kiểm |
| Output bên ngoài là dữ liệu không tin cậy | Chữ trong tool, trang web, agent con không thành thẻ ràng buộc hay cách trình bày (YC-016, YC-019, YC-020). Thẻ bài học có thể mang ý từ nguồn ngoài; lớp chặn là nhãn "model đề xuất" và xác nhận của người dùng (Story 6) |
| Bí mật | Thẻ qua kiểm chuỗi giống khoá API (YC-022); dòng thẻ không có khoá |
| Test không chạm mạng và `~/.opentrading` thật | Thư mục dữ liệu tạm, model giả, `fetch` giả |
| Không bịa số | Hướng dẫn thẻ cấm đề xuất số liệu, giá (YC-015). Bản tóm tắt không chép nội dung memory (YC-001) |
| Chỉ người dùng làm memory có hiệu lực; model không có tool ghi | Gỡ `propose_memory` và hook (YC-009). Thẻ không ghi kho cho tới khi người dùng bấm Xác nhận (YC-025) |
| Lịch sử phiên append-only; xoá là che | Dòng thẻ chỉ nối thêm (YC-027). Xoá có hiệu lực cả với phần đã nén vì bản tóm tắt không có nội dung (YC-001) |
| Quyết định không tự vào context | Quyết định không có thẻ (YC-018); dòng thẻ và dòng nhắc không có nội dung quyết định (YC-030) |
| Agent con không nhận memory, không có tool lịch sử | Không đổi. Agent con không có hướng dẫn thẻ; chữ của agent con không thành thẻ (YC-016) |
| Thiếu dữ liệu phải nói ra | Bản tóm tắt ghi nhãn chỗ đã lược; lượt đầu sau nén nói rõ phải đọc lại (YC-006) |

## 7. Điểm đụng lõi

| Phần lõi | Cần thay đổi gì, vì sao | Nhãn |
| --- | --- | --- |
| Nén hội thoại (mẫu tóm tắt, request tóm tắt, chỗ gọi nén trong giao diện) | Lược nội dung khối trước khi tóm tắt; bỏ mục lục và `rang_buoc` khỏi request tóm tắt; mẫu hai bản có "Ràng buộc và sở thích" và câu dặn nhãn (YC-001–YC-005). Vì K3, K5, C10 B9 | `blocked-by-core` |
| Cấu hình và runtime memory | Bỏ lựa chọn "file", chuyển cấu hình cũ, công tắc thẻ (YC-009–YC-012, YC-031) | `blocked-by-core` |
| Vòng agent và hợp đồng `MemoryProvider` | Tách khối thẻ khỏi câu trả lời trước khi vào lịch sử (YC-016, YC-017); đưa kết quả thẻ và dấu "vừa nén" cho memory (YC-006, YC-029); bỏ phần hợp đồng chỉ memory cũ dùng (YC-014) | `blocked-by-core` |
| Lưu và đọc phiên | Loại dòng thẻ mới, đọc lại khi mở phiên (YC-027, YC-028) | `blocked-by-core` |
| Giao diện (stream, transcript, `/config`, `/memory`, form spec 003) | Ẩn khối thẻ lúc stream; hàng thẻ và phím; form nhận nội dung điền sẵn và nguồn "từ thẻ gợi ý", báo kết quả cho thẻ; câu báo chuyển (YC-011, YC-017, YC-023–YC-026, YC-031, YC-032) | `blocked-by-core` |

Phần thuộc memory (không phải lõi): bộ đọc khối thẻ và kiểm câu gốc; dòng nhắc nén và dòng nhắc thẻ của sổ; hướng dẫn trong `prompts/memory.md`; lược khối trước khi tóm tắt (dùng bộ nhận khối của spec 006).

**Việc phải ghi trong mô tả PR:** spec này đổi hợp đồng `MemoryProvider` (thêm kết quả thẻ và dấu vừa nén; bỏ phần của memory cũ), định dạng file phiên (thêm dòng thẻ) và cấu hình (bỏ `"file"`). Bản app cũ mở file mới vẫn chạy nhưng không hiện thẻ.

## 8. Phạm vi

**Trong phạm vi:**
- Story 1 tới 8, YC-001 tới YC-033.
- Gỡ giới hạn cuối của lộ trình: bản tóm tắt chép nội dung khối memory.
- Việc 31a (lưu trùng "Ghi nhớ:") hết vì memory cũ bị gỡ.

**Đối chiếu với memory của Claude Code (việc 33b).** 33b muốn memory dài hạn kiểu Claude Code. Đã xem thư mục memory của Claude Code trên máy người dùng và cách nó hoạt động. Người dùng chốt (07/11/2026): Sổ ghi nhớ thay 33b, phần "model tự ghi" thay bằng thẻ có duyệt.

| Tính năng memory của Claude Code | Sổ ghi nhớ | Xử lý |
| --- | --- | --- |
| Mỗi mục một bản ghi có loại (user, feedback, project, reference) | Loại riêng cho đầu tư: ràng buộc, cách trình bày, luận điểm, bài học, quyết định | Đã có |
| `MEMORY.md` chỉ mục luôn nạp, có giới hạn, báo khi cắt | Mục lục luôn nạp, theo hạng model, "… còn N" | Đã có |
| Mô tả một dòng để chọn mục liên quan | Mục lục có tiêu đề hoặc mã; chọn theo mã và tìm bài học | Đã có một phần; không làm thêm |
| Sửa thay vì tạo trùng | Bản mới theo phiên bản; form cảnh báo trùng | Đã có |
| Xoá mục sai | `/memory` xoá, che trong lịch sử | Đã có |
| Danh sách "không lưu" | Cảnh báo số liệu, từ chối chuỗi giống khoá API, "memory không phải nguồn số liệu" | Thêm luật "không đề xuất" cho thẻ (YC-015) |
| Ghi chú tuổi của memory | Nhãn có ngày ghi tuyệt đối | Đã có |
| Người dùng bảo bỏ qua memory thì coi như rỗng | Chưa có | Thêm (YC-033) |
| Liên kết giữa các mục | Bài học "áp dụng cho" mã, ngành; luận điểm trỏ ngành | Đã có một phần; không làm thêm |
| Bật, tắt | `/config` Tắt, Sổ | Đã có; thêm công tắc thẻ (YC-031) |
| Model tự ghi, agent nền tự trích | Cố ý không làm (`design.md` dòng "Chỉ ra `proposed`"; MINJA) | Thay bằng thẻ có duyệt (Story 5, 6) |
| Thư mục Markdown đọc, sửa tay được | SQLite; xuất Markdown bằng Ctrl+X trong `/memory` | Việc theo sau, ngoài spec này: xuất ra thư mục Markdown theo loại |
| Memory nhóm, memory theo agent | Không | Ngoài phạm vi ("Để sau": chia sẻ quyết định) |

**Ngoài phạm vi:**
- **Nhập ghi chú memory cũ vào sổ** (tự động hay qua thẻ): người dùng chốt chỉ báo đường dẫn; tự chép bằng `/nho`, `/baihoc`.
- **Thẻ sửa hay xoá mục có sẵn**, thẻ luận điểm, thẻ quyết định.
- **Che chữ trong câu trả lời cũ của model** đã nói lại nội dung một mục (cả khi chữ đó đi vào bản tóm tắt): như spec 006 §8.
- **Ngân sách memory theo phiên, thu gọn khối không còn tập trung** (§B3 mục 9): đo rồi mới làm.
- **Tool lịch sử theo mã lượt, đọc file agent con và nhật ký ultradesk** (C-8): giai đoạn lịch sử.
- **Nhập ràng buộc cũ từ `INVESTOR.md`**, bộ đo C13, đo cache với model thật: như lộ trình ("Ngoài lộ trình này").
- **Để sau (§C13):** mã gõ sai; chủ đề xuất hiện giữa lượt; ISIN; Cedar; chia sẻ quyết định.

## 9. Giả định

- Hai kênh của memory (phần nhắc nhở memory, kết quả `memory_read`) và cách nhận khối giữ như spec 006. Bộ lược trước khi tóm tắt dùng cùng bộ nhận khối, nên nhãn giả ở kênh khác không bị lược.
- Mục lục và ràng buộc được dựng lại mỗi request, nên bỏ chúng khỏi request tóm tắt không làm mất gì sau nén (`design.md` §8.5).
- Thẻ là tiện ích, không phải điều kiện để sổ hoạt động (design-v5 §6): tắt thẻ thì sổ vẫn đủ chức năng.
- Định dạng chính xác của khối thẻ, dòng thẻ, dòng nhắc nén và dòng nhắc thẻ chốt ở plan. Các câu trong spec là mẫu để test so. Dòng nhắc thẻ mang mã thẻ, dòng nhắc nén mang dấu của lần nén, để hai thẻ cùng bị bỏ qua hay hai lần nén không bị gộp làm một khi so theo lịch sử.
- Câu báo chuyển memory cũ chỉ cần hiện một lần; "một lần" dựa vào việc cấu hình đã được ghi lại thành `"notebook"`, và chỉ giao diện ghi lại (YC-010, YC-011). Ghi lỗi thì lần sau hiện lại (§3).
- Dòng lệnh không giao diện và bộ chạy đo hiện không dùng memory; spec này không đổi điều đó (nối memory với bộ đo là việc riêng, ngoài spec này).
- Mặc định bật thẻ vì người dùng chủ động chọn Sổ ghi nhớ; tắt sẵn trên hạng C vì model nhỏ tạo tag kém (design-v5 §6).

## 10. Kiểm chất lượng

**Tự kiểm vòng 1 (bản nháp, 07/11/2026):**

| Mục | Kết quả |
| --- | --- |
| Không có chi tiết cài đặt (tên hàm, file, SQL) | Đạt. Chỉ nhắc tên người dùng thấy (`/config`, `/memory`, `/nho`, `/baihoc`, `/compact`, `memory_read`, `propose_memory`) và tên hợp đồng `MemoryProvider` ở §7 |
| Mọi yêu cầu kiểm thử được | Đạt. Mỗi YC có kịch bản hoặc TC; lược và tách kiểm bằng chuỗi đánh dấu |
| Mọi yêu cầu dẫn nguồn | Đạt |
| Mỗi user story có Cho/Khi/Thì với ví dụ cụ thể | Đạt |
| Có tình huống biên và lỗi | Đạt (§3: nén lần hai, nén lỗi, chỉ dọn tool, ghi cấu hình lỗi, câu gốc, lượt cứu, kho tắt khi thẻ chờ, ghi dòng thẻ lỗi) |
| Phạm vi có giới hạn, có "Ngoài phạm vi" | Đạt |
| Không mâu thuẫn "Đã chốt" hay bất biến | Đạt. Loại thẻ đúng bảng chính sách; thẻ không ghi kho (spec 001 YC-022) |
| Điểm đụng lõi liệt kê, gắn `blocked-by-core` | Đạt: 5 dòng |
| Không quá 3 chỗ `[CẦN LÀM RÕ]` | Đạt: 3 chỗ ở vòng 1, đã chốt hết ở vòng 2 |

**Vòng 2 (07/11/2026, rà soát và chốt câu làm rõ):**
- Người dùng chốt ba câu làm rõ: bỏ khối `rang_buoc` khỏi request tóm tắt (§3, YC-003); giữ hành vi tạm che ở phần giữ lại sau nén (§3); bỏ `pending`, `approve`, `reject` khỏi hợp đồng `MemoryProvider` (YC-014).
- Dòng lệnh không giao diện và bộ chạy đo hiện không dùng memory: sửa Story 4 kịch bản 3 (chỉ hiểu `"file"`, không ghi lại, không báo), thêm kịch bản 4 (chạy dòng lệnh trước rồi mới mở giao diện thì câu báo vẫn hiện một lần). YC-010, YC-011: chỉ giao diện ghi lại cấu hình, cùng bước với câu báo.
- Thẻ ràng buộc có hai chữ khác vai: câu model đề xuất (điền sẵn vào form) và câu gốc người dùng gõ (hiện để đối chiếu, dùng để kiểm YC-019). Sửa Story 5 kịch bản 1, 2, YC-024, Thực thể.
- Khối không có thẻ đóng không được nuốt chữ phía sau: thêm Story 6 kịch bản 8, sửa YC-017, TC-006 (design-v5 §6).
- Hai lần nén gần nhau vẫn có dòng nhắc nén cho lần sau: thêm Story 3 kịch bản 6, sửa YC-006, TC-003.
- Nói rõ giới hạn của thẻ bài học với MINJA (không buộc vào câu gốc; lớp chặn là nhãn "model đề xuất" và xác nhận trong form): Story 6, §6.
- Dòng nhắc thẻ mang mã thẻ, dòng nhắc nén mang dấu lần nén (§9).
