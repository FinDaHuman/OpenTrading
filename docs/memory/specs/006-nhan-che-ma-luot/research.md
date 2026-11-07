# Research 006: các lựa chọn kỹ thuật

Mỗi mục: quyết định, lý do, phương án đã cân nhắc. Mọi khẳng định về code đã kiểm trên commit `c2776f5` (sau khi gộp `main` ngày 06/11/2026).

## R-1. Nhận diện một khối trong lịch sử, và khi nào được che vĩnh viễn

**Quyết định:** không đổi nhãn khối. Bộ kiểm cho mỗi khối một trong bốn kết quả:

| Kết quả | Khi nào | Hệ quả |
| --- | --- | --- |
| **Đã xoá** | Kho có dấu xoá của đúng mục và bản đó (`lessons.deleted_at`; `thesis_versions.deleted_at`), **hoặc** kho không có mục hay bản đó. Bài học tìm theo số; luận điểm tìm theo **mọi** bí danh của chủ đề, kể cả đã thôi dùng | Che vĩnh viễn: thay trong lịch sử đang mở, ghi dòng che |
| **Khác nội dung** | Kho có đúng mục và bản đó, chưa xoá, nhưng dòng nội dung bất biến của khối không trùng dòng dựng lại từ kho (ca kho tạo lại trùng số) | **Tạm che** trong những gì gửi đi. Không thay lịch sử, không ghi dòng che |
| **Còn** | Kho có đúng mục và bản đó, chưa xoá, nội dung trùng | Giữ nguyên |
| **Cụt, còn** | Khối bị một dấu cắt của lõi cắt ngang, và kho có mục, bản đó chưa xoá | Không so nội dung, giữ nguyên. Khối cụt mà kho báo đã xoá thì vẫn là "đã xoá": xác nhận xoá không cần nội dung |

- **Dòng nội dung bất biến:**
  - luận điểm: "Luận điểm:", "Sai nếu:", "Hạn xem lại:", "Chi tiết:";
  - bài học: "Tiêu đề:", "Tóm tắt:", "Ngoại lệ:", "Chi tiết:", "Tag:".

  Không so các dòng đổi được mà không sinh bản mới: "Trạng thái:", "Liên quan:" (bản ngành có thể đổi), "Áp dụng cho:" (tên hiển thị có thể đổi), phần "thay cho bản N" trong nhãn.
- **Nhiều chủ đề cùng khớp một tên** (bí danh dùng lại):
  - một chủ đề còn và trùng nội dung: "còn";
  - không chủ đề nào có bản đó chưa xoá: "đã xoá";
  - còn lại: "khác nội dung".
- **Khối cụt:** khối mà ngay sau dòng cuối của nó là một dấu cắt của lõi, trước ranh giới kế tiếp. Có ba dấu:
  - `[... đã lược N ký tự ...]` của `truncate` trên mọi kết quả tool (`src/core/tools/wrap.ts:88-93, 181`, trần `DEFAULT_MAX_OUTPUT_CHARS = 30_000` ở `src/core/tools/types.ts:157`);
  - `[… đã cắt bớt]` của trần phần nhắc nhở (`src/core/agent.ts:777-778`);
  - `[… phần còn lại đã được cắt bớt…]` của ngân sách lớp (`src/core/prompt/budget.ts:57`).

  Đoạn chữ đứng sau dấu cắt mà không mở đầu bằng dòng nhãn là mảnh vụn, không phải khối.

**Lý do: vì sao "khác nội dung" không được che vĩnh viễn.** Dòng che không bao giờ gỡ được: nó nằm trong file append-only. Vì vậy chỉ được ghi khi chắc chắn mục đã mất. "Khác nội dung" có thể xảy ra mà mục vẫn còn sống:
1. Kết quả tool bị cắt ở trần 30.000 ký tự: một lần `memory_read` tìm nhiều bài học có khối cuối bị cụt.
2. Một bản app sau đổi cách escape hay định dạng một dòng: mọi khối ghi trước đó lệch với dòng dựng lại.
3. Lớp bọc tool thêm dòng trước kết quả. Hiện `memory_read` có nguồn `memory:` nên không bị gắn mã dữ liệu (`stampRef` chỉ áp nguồn `mcp:`, `wrap.ts:13-20`) hay dòng báo nguồn (`sourceEnvelope`). Nhưng lớp bọc có thể đổi sau này.

Che vĩnh viễn ở các ca này là mất một bài học người dùng chưa xoá trong phiên đó, không lấy lại được. Tạm che thì an toàn cả hai phía:
- kho tạo lại trùng số không làm nội dung cũ đi ra;
- mục còn sống thì không mất gì trong file. Tạm che chỉ áp trên bản gửi đi, và sổ ghi nhớ nhận bản đó qua `history`. Sổ thấy chỗ đã tạm che là "chưa có khối", nên khi chủ đề còn tập trung, nó chèn khối bản hiện hành từ kho; model vẫn có nội dung đúng.

**Lý do chung cho cách nhận diện:**
- Nhãn luận điểm chỉ có tên hiển thị (`src/core/memory/notebook/render.ts:121`), và bí danh đã thôi dùng có thể được một chủ đề mới dùng lại (bảng `subject_aliases` chỉ cấm trùng giữa các bí danh **đang dùng**, `src/core/memory/store/schema.ts:56`).
- Kho không có mã riêng (lược đồ bản 1). So nội dung là cách duy nhất không đổi nhãn để tách ca "kho tạo lại cùng ngày, #7 mới cùng số, cùng bản, cùng ngày".
- Không đổi nhãn nên prompt cache không vỡ, test định dạng của spec 002 giữ nguyên, phiên cũ không cần đọc hai kiểu nhãn.

**Phương án đã cân nhắc:**

| Phương án | Bị loại vì |
| --- | --- |
| Thêm mã chủ đề và mã kho vào nhãn (`[Memory · luận điểm · HPG · #c12 · kho 3f9a · …]`) | Đổi định dạng spec 002 đã chốt, vỡ cache một lần, model đọc thêm ký hiệu vô nghĩa. Mã kho cần bản lược đồ 2, khiến bản app trước không mở được kho. Phiên cũ vẫn mang nhãn kiểu cũ |
| Dòng phụ trong file phiên ghi "khối X thuộc kho K, mục M" | Thêm một loại dòng lõi nữa; hai khối cùng chữ nhãn từ hai kho vẫn không phân biệt được nếu chỉ khoá theo chữ nhãn |
| Chỉ so số mục, số bản, ngày ghi | Sai ở ca tạo lại kho trong cùng ngày |
| Coi "khác nội dung" là "đã xoá" và ghi dòng che | Che vĩnh viễn khối còn sống ở ba ca trên |

## R-2. Lõi đưa "danh sách nhãn" cho memory bằng cách nào

**Quyết định:** lõi đưa **lịch sử sẽ gửi** (danh sách tin nhắn) trong ngữ cảnh của `recall`. Phần memory tự tách khối, nhưng chỉ từ hai kênh của memory:
- phần `<memory_lien_quan>` nằm trong phần nhắc nhở của tin nhắn người dùng;
- kết quả của tool `memory_read`.

Thông tin mã lượt **không** có trong danh sách nhãn (spec YC-001 để plan quyết; không story nào cần).

**Lý do:**
- Phần nhắc nhở là một phần văn bản riêng, đứng trước chữ người dùng gõ (`userMessage`, `src/core/agent.ts:354-365`). Vì vậy chữ người dùng gõ và tệp đính kèm không bao giờ nằm trong kênh memory.
- Mỗi khối là một mục `- <khối>` trong `<memory_lien_quan>` (`agent.ts:1039-1041`, `prompt/assemble.ts:245`).
- Nội dung memory không bao giờ mở đầu một dòng và không có dòng trống (`notebook/escape.ts`): dòng nào mở đầu bằng `[Memory · luận điểm ·` hay `[Memory · bài học ·` (sau `- ` nếu có) chắc chắn là nhãn do provider viết.
- Lõi không cần biết định dạng khối; hợp đồng chỉ thêm một trường.

**Phương án đã cân nhắc:**
- Lõi tự tách nhãn rồi đưa danh sách đã tách: lõi phải biết định dạng khối của một provider cụ thể.
- Provider tự giữ danh sách trong RAM như hiện nay: đây chính là giới hạn spec này phải gỡ.

## R-3. `memory_read` biết khối nào model đang thấy ở bước này

**Quyết định:** truyền danh sách tin nhắn mà AI SDK đưa cho hàm `execute` của tool vào ngữ cảnh tool của OpenTrading (thêm `messages` vào `ToolContext`). `memory_read` tách khối từ danh sách đó.

**Lý do:**
- AI SDK 7.0.159 gọi `execute` với `messages` của bước. Đó là bản đã qua `prepareStep` của vòng agent, tức đã dọn kết quả tool cũ khi gần ngưỡng: `node_modules/ai/dist/index.js:9692-9694` (`stepMessages = prepareStepResult?.messages ?? stepInputMessages`), `:9913` (truyền `messages: stepMessages` cho `executeToolsFromStream`). Kiểu: `ToolExecutionOptions.messages` (`@ai-sdk/provider-utils` `index.d.ts:2128`).
- Kết quả tool bị dọn mang chữ "đã dọn kết quả cũ" thay cho nội dung (`src/core/compact.ts`, `PRUNED_TEXT`), nên nhãn không còn và tool trả khối đầy đủ (Story 6 kịch bản 3).
- Hiện registry chỉ chuyển `abortSignal` và `toolCallId` (`src/core/tools/registry.ts:183-188`).

**Phương án đã cân nhắc:** provider giữ "lần gọi recall gần nhất" như hiện nay (`provider.ts`, `track`). Cách này không biết kết quả nào bị dọn giữa lượt.

## R-4. Che ở đâu trong luồng

**Quyết định:**
1. **Đầu mỗi lượt của agent chính**, trong vòng agent, ngay sau bước đọc ràng buộc và hồ sơ của spec 005 (bước này có thể hoãn lượt), trước `recall`:
   - dựng bản xem của lịch sử: áp phần che đã xác nhận ("đã xoá"), cộng phần tạm che (kho vắng, kho lỗi, hoặc khối "khác nội dung", R-1);
   - phát một sự kiện để giao diện thay lịch sử bằng bản đã che (chỉ phần đã xác nhận) và xếp dòng che;
   - dùng bản xem cho `recall` và cho request.
2. **Đầu mỗi lần nén**, ở hàm nén của giao diện (không sửa phần nén trong lõi), để request tóm tắt không mang nội dung đã xoá.
3. **Ngay sau khi xoá** trong `/memory`, nếu không có lượt nào đang chạy **và không có lần nén nào đang chạy** (kể cả nén khi rảnh): che lịch sử đang mở và xếp dòng che, để Story 4 kịch bản 3 xảy ra lúc xoá.
   - Có lượt đang chạy thì để bước 1 của lượt sau làm (lượt đang chạy không đổi, spec YC-005).
   - Có lần nén đang chạy thì cũng để bước 1 của lượt sau làm. Lần nén đã giữ bản lịch sử cũ và khi xong sẽ đặt lịch sử bằng kết quả nén. Che lúc đó thì phần che bị mất, lượt sau che lại và có thể ghi dòng che lần hai. Bản nén vừa xong còn khối nào của mục đã xoá thì lượt sau che đúng một lần.
4. **Mở lại phiên, `/export`, tool đọc phiên cũ:** bộ đọc phiên áp dòng che trong file, rồi hỏi kho. Chỉ mở lại phiên mới ghi dòng che.

**Lý do:**
- Bước 1 đặt sau đọc ràng buộc. Như vậy lượt bị hoãn (kho lỗi, spec 005) không che hay báo gì; chỉ lượt người dùng chọn chạy tiếp mới tạm che (spec Story 3 kịch bản 7).
- Lịch sử của phiên đang mở nằm ở trạng thái giao diện (`state.history`, `src/tui/app.tsx:606-607` truyền vào `runAgent`). Vì vậy phần đã xác nhận phải được giao diện ghi lại, không chỉ dùng trong request.
- Tạm che **không** ghi vào lịch sử trong RAM: kho có lại thì lượt sau gửi khối nguyên văn (spec YC-010).
- Bước 2 và bước 3 cùng chờ lần nén: hàm nén của giao diện đã che ở đầu nó (bước 2), nên dòng che chỉ được ghi một lần cho mỗi mục.

**Phương án đã cân nhắc:**
- Chỉ che ở giao diện trước khi gọi vòng agent: lượt bị hoãn sẽ báo tạm che trùng với thẻ hoãn.
- Chỉ che khi xoá: không bắt được xoá ở cửa sổ khác (spec YC-006).

## R-5. Mã lượt

**Quyết định:**
- Dòng kết thúc lượt có thêm trường `turn`: số lượt lúc lượt vào hàng ghi, chính là số mà biên nhận spec 004 đã dùng.
- Bộ đọc phiên tính số lượt cuối từ file. Đi theo từng dòng kết thúc lượt: dòng có `turn` thì lấy số đó, dòng không có thì lấy số trước cộng một.
- Mở lại phiên thì đối tượng phiên đếm tiếp từ số này, không từ dòng chỉ mục.

**Lý do:**
- Hiện số lượt khi mở lại lấy từ `summary.turns` của dòng chỉ mục (`src/core/session/store.ts:304-305`, `Session.continue` dòng 316). Dòng chỉ mục có thể cũ hơn file khi lần ghi chỉ mục lỗi (spec Story 5 kịch bản 5).
- Lượt lưu bù giữ số của nó, vì số gán lúc vào hàng.

## R-6. Định dạng dòng che và chữ thay khối

**Quyết định:**
- Dòng che: `{"type":"redact","ts":…,"items":[{"kind":"lesson","id":7,"versions":[1]},{"kind":"thesis","name":"HPG","versions":[2,3]}]}`. Dòng che áp cho khối khớp loại, mục (số bài học hoặc tên trong nhãn luận điểm) và bản, nằm **trước** nó trong file.
- Chữ thay khối:
  - bài học: `[Memory · bài học #7 đã bị người dùng xoá]`;
  - luận điểm: `[Memory · luận điểm HPG đã bị người dùng xoá]`.
- Chữ tạm che (chỉ trong những gì gửi đi, không vào lịch sử):
  - bài học: `[Memory · bài học #7 · bản 1 tạm che: chưa đối chiếu được với kho]`;
  - luận điểm: `[Memory · luận điểm HPG · bản 3 tạm che: chưa đối chiếu được với kho]`.

  Không dùng chữ "đã bị người dùng xoá" cho tạm che, vì có thể sai: kho vắng, kho lỗi hay khối khác nội dung không chứng minh được việc xoá. Sổ ghi nhớ coi chỗ tạm che là "chưa có khối" (R-1).

**Lý do:**
- Nhãn luận điểm không có số, nên dòng che và chữ thay dùng tên đúng như trong nhãn. Spec YC-005 viết mẫu `<loại> #<số>`; với luận điểm, "số" là tên. Cách hiểu này đã được chấp nhận khi duyệt plan.
- Ghi cả số bản để một khối cùng tên của chủ đề khác (bí danh dùng lại) với bản khác không bị che nhầm.

## R-7. Đọc kho để kiểm che

**Quyết định:**
- Một module kiểm riêng mở `memory.db` **chỉ để đọc**, theo đúng cách đọc ràng buộc của spec 005:
  - nhìn file trước;
  - mở `readwrite + create:false + query_only`;
  - hạn chờ chung `DEADLINE_MS`, thử lại khi lỗi thoáng qua;
  - đóng ngay sau khi đọc.
- Module chạy với mọi lựa chọn memory trong `/config`.
- Module chỉ trả kết quả của R-1 cho từng khối ("đã xoá", "khác nội dung", "còn", "cụt, còn"), không trả nội dung ra ngoài.
- Chỉ chạy khi lịch sử có khối memory. Lịch sử không có khối thì không mở kho và không báo gì (spec YC-010, ca im lặng).

**Lý do:**
- `openStoreReadOnly` và `timedRead` của spec 005 đã chạy trên Windows: không giữ file, không tạo file (`src/core/memory/store/read-only.ts`, `src/core/memory/binding/timed-read.ts`, `src/core/memory/binding/constraints.ts:96-125`).
- Bộ kiểm đọc cả bí danh đã thôi dùng và bản luận điểm cũ, mà cổng đọc theo bảng chính sách không trả hai thứ này (vai `main_agent`, hành động `match` chỉ có bí danh đang dùng, `src/core/memory/policy.ts:80`). Đây là quyền đọc của người dùng (spec §9), không đi qua bảng của vai model. Nó chỉ quyết định che, không đưa chữ nào ra ngoài.

**Phương án đã cân nhắc:** thêm hành động mới vào bảng chính sách cho vai model. Bị loại vì không có nội dung nào tới model; bảng là để chặn nội dung đi đâu.
