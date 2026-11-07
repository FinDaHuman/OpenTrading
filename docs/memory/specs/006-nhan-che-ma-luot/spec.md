# Spec 006: Phương án Y đầy đủ trong lõi: nhãn trong lịch sử, che khi xoá, mã lượt

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (06/11/2026, qua cổng 1 vòng 2). Đã implement theo [plan](plan.md), [tasks](tasks.md) xong; chờ duyệt code trên PR #229 |
| **Ngày tạo** | 05/11/2026 |
| **Nhánh** | `feat/memory` |
| **Mô tả gốc** | "Phương án Y đầy đủ trong lõi: lõi đưa memory danh sách nhãn đang có trong lịch sử; xoá thì che khối trong lịch sử đang mở; dòng che trong file phiên, áp khi mở lại phiên; mã lượt" (lộ trình `specs/README.md`, thứ tự 7) |
| **Dựa trên** | Quyết định Q1 (phương án Y, đợt đầy đủ); vấn đề K3, K5; giải pháp §B3 (mục 2, 5, 6); kiến trúc v5.1 mục C3 (file phiên JSONL: dòng che, mã lượt), C8 (dòng "Xoá một mục"), C10 (B9, B10), C11 (C-1 phần mã lượt và dòng che, C-4 phần danh sách nhãn và che) (`docs/memory/ra-soat-v5.md`); ADR 0002 (bảng "làm theo hai đợt", đợt đầy đủ, mục 2, 5, 6) |

## 1. Bối cảnh và mục tiêu

Spec 002 làm bản tối thiểu của phương án Y: sổ ghi nhớ tự nhớ trong bộ nhớ tạm khối nào đã gửi trong phiên. Bản này có hai giới hạn, ghi ở lộ trình:

| Giới hạn | Ví dụ người dùng gặp |
| --- | --- |
| Sau nén hoặc mở lại phiên, khối memory có thể bị **chèn lại hoặc thiếu** | Khởi động lại app, mở lại phiên hôm qua, hỏi tiếp về HPG: luận điểm HPG bản 3 đã có trong lịch sử nhưng được chèn thêm lần nữa. Ngược lại, sau khi nén, khối đã ra khỏi lịch sử nhưng sổ tưởng còn nên không chèn |
| Xoá chỉ báo "đã ngừng dùng", **chưa che** nội dung cũ | Xoá bài học #7 giữa phiên: nội dung #7 vẫn nằm trong lịch sử và vẫn được gửi cho model ở mọi lượt sau, chỉ kèm một dòng dặn "không dùng nữa". Mở lại một phiên cũ đã đọc #7 thì model lại nhận #7 |

Gốc của cả hai là sổ ghi nhớ không nhìn thấy lịch sử thật. Spec này cho lõi làm ba việc:

1. đưa cho memory **danh sách nhãn** đang có trong lịch sử thật của phiên;
2. **che** mọi khối của mục đã xoá, trong phiên đang mở và mỗi khi đọc lại bất kỳ phiên nào;
3. ghi **dòng che** và **mã lượt** vào file phiên.

Kết quả mong muốn:
- sổ quyết định chèn hay không chèn dựa trên đúng thứ đang có trong lịch sử. Vì vậy cùng một lịch sử thì cùng một quyết định, dù app vừa khởi động lại hay phiên vừa được mở lại;
- xoá có hiệu lực với mọi lần gửi sau (C10 B9);
- file phiên chứa đúng những gì model đã thấy, và chỉ ra được vị trí theo mã lượt (C10 B10, K5).

Phần nén hội thoại (bản tóm tắt, mẫu tóm tắt chỉ giữ nhãn) thuộc spec 007, không thuộc spec này (§8).

## 2. User story và kịch bản nghiệm thu

Ví dụ dùng chung, lấy từ kho mẫu của spec 002:
- chủ đề HPG có luận điểm bản 3 "Hưởng lợi từ đầu tư công", lưu ngày 20/10/2026;
- bài học #3 "Quản trị rủi ro khi giải ngân", bài học #7 "Định giá ngân hàng" (bản 1);
- ràng buộc #1 "Không dùng margin, kể cả T+0".

Khối có nhãn và dòng nhắc giữ định dạng của spec 002, ví dụ dòng nhãn `[Memory · bài học · #7 · bản 1 · ghi … · người dùng tự ghi]`.

Mọi kịch bản kiểm được bằng `bun test` với model giả, thư mục dữ liệu tạm, so trên request đã gửi và trên file phiên.

### Story 1: Mở lại phiên thì khối không bị chèn lặp, không bị thiếu (P1)

Người dùng hỏi về HPG hôm qua. Hôm nay họ khởi động lại app, mở lại phiên đó và hỏi tiếp. Họ muốn model thấy luận điểm HPG đúng một lần, ở bản hiện hành, và được báo nếu luận điểm đã đổi từ hôm qua.

- **Vì sao ưu tiên này:** khối lặp làm request dài hơn và vỡ prompt cache. Khối thiếu làm model trả lời mà không có luận điểm. Dòng nhắc bị mất sau khi khởi động lại làm model dùng bản cũ trong im lặng (ADR 0002 mục 4).
- **Kiểm độc lập:** tạo phiên có khối HPG bản 3, đóng app (bỏ hết trạng thái trong bộ nhớ tạm), mở lại phiên, gửi một lượt, so request.

**Kịch bản nghiệm thu:**

1. **Cho** phiên S1 đã có lượt 1 "Hòa Phát?" với khối HPG bản 3, rồi app khởi động lại và người dùng mở lại S1,
   **khi** lượt 2 gửi "HPG còn rủi ro nào?",
   **thì** lượt 2 không có khối HPG mới, và khối HPG bản 3 trong lượt 1 nằm trong request giống hệt từng byte như lúc gửi lượt 1.
2. **Cho** như kịch bản 1, nhưng trước khi mở lại, luận điểm HPG được lưu bản 4,
   **khi** lượt 2 gửi "HPG còn rủi ro nào?",
   **thì** lượt 2 có khối HPG bản 4, nhãn kèm "thay cho bản 3", và không có thêm dòng nhắc "đã có bản 4".
3. **Cho** như kịch bản 2,
   **khi** lượt 2 gửi "VCB có rẻ không?" (không nhắc HPG),
   **thì** lượt 2 có dòng nhắc "Luận điểm HPG đã có bản 4; bản 3 phía trên đã cũ", đúng một lần.
4. **Cho** như kịch bản 3, lượt 2 đã có dòng nhắc, rồi app khởi động lại và người dùng mở lại S1 lần nữa,
   **khi** lượt 3 gửi "Còn ACB?",
   **thì** lượt 3 **không** lặp lại dòng nhắc đó, vì dòng nhắc đã nằm trong lịch sử.
5. **Cho** một lượt bị lỗi "hội thoại quá dài" trước khi chạy tool, app bỏ tin nhắn của lượt đó và gửi lại,
   **khi** lượt gửi lại hỏi "Hòa Phát?",
   **thì** lượt gửi lại có khối HPG bản 3 (không thiếu khối như ở bản tối thiểu).
6. **Cho** phiên có khối HPG bản 3 ở lượt 1,
   **khi** người dùng tắt sổ ghi nhớ rồi bật lại trong `/config`, và lượt 2 nhắc HPG,
   **thì** lượt 2 không chèn lại khối HPG bản 3.

### Story 2: Xoá thì che khối trong hội thoại đang mở (P1)

Model đã đọc bài học #7 ở lượt 1. Người dùng xoá #7 trong `/memory`. Họ muốn từ lượt sau, model không còn nhận nội dung #7 ở bất kỳ đâu trong request, kể cả trong lịch sử.

- **Vì sao ưu tiên này:** đây là giới hạn thứ hai của bản tối thiểu. Một dòng dặn "không dùng nữa" không bảo đảm model làm theo, và nội dung vẫn được gửi cho provider ở mỗi lượt (C10 B9).
- **Kiểm độc lập:** chuỗi lượt với xoá xen giữa; tìm một chuỗi đánh dấu duy nhất (đặt trong nội dung #7) trong mọi request sau khi xoá.

**Kịch bản nghiệm thu:**

1. **Cho** lượt 1, model gọi `memory_read` bài học 7 và nhận khối #7 bản 1 (có chuỗi đánh dấu `DANHDAU-7`), rồi người dùng xoá #7,
   **khi** lượt 2 gửi "Còn ACB thì sao?",
   **thì:**
   - request lượt 2 không chứa `DANHDAU-7` ở bất kỳ đâu;
   - chỗ khối #7 trong kết quả tool của lượt 1 là dòng `[Memory · bài học #7 đã bị người dùng xoá]`;
   - phần còn lại của kết quả tool và của lượt 1 giữ nguyên.
2. **Cho** lượt 1 có khối HPG bản 3 ở phần nhắc nhở, và model gọi `memory_read` tìm theo từ khoá "ngân hàng giải ngân", nhận hai khối #3 và #7; rồi người dùng xoá #7,
   **khi** lượt 2 gửi,
   **thì** chỉ khối #7 bị thay; khối #3 trong cùng kết quả tool và khối HPG bản 3 giữ nguyên từng byte.
3. **Cho** khối #7 xuất hiện ở hai lượt (lượt 1 qua `memory_read`, lượt 3 qua tìm theo từ khoá),
   **khi** xoá #7 rồi gửi lượt 4,
   **thì** cả hai chỗ đều bị che.
4. **Cho** #7 bị xoá,
   **khi** lượt kế tiếp gửi,
   **thì** lượt đó có dòng nhắc "[Memory · nhắc] Bài học #7 đã bị người dùng xoá", đúng một lần, như spec 002.
5. **Cho** #7 bị xoá khi phiên này chưa từng có khối #7,
   **khi** lượt kế tiếp gửi,
   **thì** lịch sử không đổi byte nào, không có dòng che nào được ghi, và không có dòng nhắc.
6. **Cho** cửa sổ A đang mở phiên S1 có khối #7, và người dùng xoá #7 ở cửa sổ B,
   **khi** lượt kế tiếp của A gửi,
   **thì** request của A không chứa `DANHDAU-7`, và file của S1 có dòng che.
7. **Cho** lượt 2 đang chạy: model đã nhận khối #7 bản 1 từ `memory_read` ở bước đầu và đang chạy một tool dữ liệu. Đúng lúc đó người dùng xoá #7 ở cửa sổ khác,
   **khi** lượt 2 chạy tiếp các bước còn lại rồi kết thúc, và lượt 3 gửi "Còn ACB?",
   **thì:**
   - các request còn lại của lượt 2 vẫn có khối #7 như cũ (lượt đang chạy không đổi giữa chừng);
   - lượt 2 được ghi vào file đúng như model đã thấy, dòng che nằm sau nó;
   - request lượt 3 không chứa `DANHDAU-7`.
8. **Cho** luận điểm HPG có khối bản 2 ở lượt 1 và bản 3 ở lượt 4 (sửa giữa phiên), rồi người dùng xoá luận điểm HPG,
   **khi** lượt kế tiếp gửi,
   **thì** cả hai khối (bản 2 và bản 3) đều bị che.

### Story 3: Dòng che trong file phiên, áp mỗi khi đọc lại (P1)

Người dùng đã xoá #7. Hôm sau họ mở lại phiên đó, xuất phiên ra Markdown, hoặc hỏi model về một phiên cũ. Họ muốn nội dung #7 không quay lại ở đâu cả, kể cả ở phiên cũ chưa mở lúc xoá.

- **Vì sao ưu tiên này:** file phiên là append-only nên nội dung #7 vẫn còn trên đĩa (bất biến 8). Không che khi đọc thì mở lại phiên là gửi lại #7 cho model (C10 B9).
- **Kiểm độc lập:** chuẩn bị file phiên có khối #7 và kho có #7 đã xoá; đọc qua từng đường đọc phiên, tìm chuỗi đánh dấu.

**Kịch bản nghiệm thu:**

1. **Cho** phiên S1 trong đó #7 bị xoá ở lượt 3 (file có dòng che),
   **khi** app khởi động lại, người dùng mở lại S1 và gửi lượt 4,
   **thì** request lượt 4 không chứa `DANHDAU-7`, và các khối khác giữ nguyên từng byte.
2. **Cho** phiên S0 (cũ hơn), có khối #7 ở lượt 2, không mở lúc xoá #7, nên file S0 chưa có dòng che,
   **khi** người dùng mở lại S0 và gửi một lượt,
   **thì:**
   - request không chứa `DANHDAU-7`;
   - file S0 được nối thêm một dòng che cho #7;
   - người dùng thấy một dòng báo "Đã che 1 mục memory đã xoá trong phiên này".
3. **Cho** S0 như kịch bản 2, chưa từng được mở lại,
   **khi** người dùng xuất S0 bằng `/export`, hoặc agent chính đọc S0 bằng tool đọc phiên cũ,
   **thì:**
   - bản xuất và kết quả tool không chứa `DANHDAU-7`, chỗ đó là dòng `[Memory · bài học #7 đã bị người dùng xoá]`;
   - file S0 **không** bị ghi thêm (hai đường này chỉ đọc).
4. **Cho** S1 có dòng che cho #7, và file mở bằng một phiên bản app cũ chưa biết dòng che,
   **khi** mở lại,
   **thì** app cũ vẫn mở được phiên, không báo lỗi định dạng. Nội dung #7 hiện lại ở app cũ: đây là giới hạn đã nêu ở §8.
5. **Cho** S1 có khối #7 ở lượt 1, dòng che #7 ở sau lượt 3,
   **khi** đọc lại,
   **thì** dòng che áp cho mọi khối #7 nằm **trước** nó trong file.
6. **Cho** phiên S2 có khối HPG bản 3 (chưa xoá) và khối #7 (đã xoá trong kho, file S2 chưa có dòng che). Người dùng chuyển file kho ra chỗ khác,
   **khi** mở lại S2 và gửi một lượt,
   **thì:**
   - request không chứa nội dung khối HPG lẫn khối #7: mọi khối memory **tạm che**;
   - người dùng thấy câu báo "Không tìm thấy kho memory; các khối memory trong phiên này tạm được che cho tới khi có lại kho.";
   - file S2 không đổi byte nào (không có dòng che).

   **Khi** người dùng trả file kho về chỗ cũ rồi mở lại S2 và gửi một lượt,
   **thì:**
   - khối HPG bản 3 hiện lại nguyên văn, giống hệt từng byte như lúc gửi lần đầu;
   - khối #7 bị che, và file S2 được nối dòng che cho #7 (lần này kho đọc được và xác nhận #7 đã xoá).
7. **Cho** phiên S1 đang mở có khối HPG bản 3 và khối #3, rồi kho đọc lỗi (file hỏng),
   **khi** người dùng gửi lượt mới: lượt bị hoãn theo spec 005, và người dùng chọn "Chạy lượt này không có ràng buộc",
   **thì:**
   - request của lượt đó có các khối memory **đã tạm che** ở chỗ khối HPG và #3;
   - request có dòng báo của spec 005 rằng ràng buộc chưa được nạp;
   - file S1 không có dòng che mới.

### Story 4: Câu báo khi xoá nói đúng sự thật (P1)

Người dùng xoá #7 và đọc câu báo. Họ muốn biết đúng điều gì đã xảy ra, không bị hứa quá.

- **Vì sao ưu tiên này:** câu báo hiện nay ("Đã ngừng dùng… model được dặn không dùng nữa") đúng với bản tối thiểu. Từ spec này app che thật, nên câu báo phải đổi. Nhưng nội dung vẫn còn trên đĩa và ở provider, nên không được hứa đã xoá hẳn (bất biến 8, ADR 0002 "Mất và rủi ro").
- **Kiểm độc lập:** test giao diện headless, so câu báo.

**Kịch bản nghiệm thu:**

1. **Cho** đang xem bài học #7 trong `/memory`,
   **khi** xác nhận xoá,
   **thì** câu báo có đủ bốn ý sau, và không có các chữ "đã xoá vĩnh viễn", "xoá hoàn toàn", "đã xoá khỏi máy":
   - đã xoá khỏi ứng dụng;
   - từ lượt sau, model không còn nhận nội dung này, kể cả trong lịch sử hội thoại và khi mở lại phiên cũ;
   - câu trả lời trước đó của model có thể đã nhắc lại nội dung này;
   - bản đã gửi provider không thu hồi được.

   Câu mẫu: "Đã xoá bài học #7 khỏi ứng dụng. Từ lượt sau, model không còn nhận nội dung này, kể cả trong lịch sử hội thoại và khi mở lại phiên cũ. Câu trả lời trước đó của model có thể đã nhắc lại nội dung này. Bản đã gửi provider không thu hồi được."
2. **Cho** xoá ràng buộc #1 (ràng buộc chỉ nằm ở phần hệ thống, không nằm trong lịch sử),
   **khi** xác nhận xoá,
   **thì** câu báo bắt đầu bằng "Đã xoá ràng buộc #1 khỏi ứng dụng", nói "từ lượt sau, model không còn nhận ràng buộc này" và "bản đã gửi provider không thu hồi được". Câu báo không nhắc tới việc che lịch sử.
3. **Cho** xoá #7 thành công trong kho nhưng ghi dòng che vào file phiên đang mở bị lỗi (ổ đầy),
   **khi** xoá xong,
   **thì:**
   - câu báo xoá vẫn như kịch bản 1, vì lịch sử đang mở đã được che và mọi lần đọc lại vẫn che theo kho;
   - riêng việc ghi dòng che được báo như mọi lần ghi phiên lỗi: "chưa lưu được, sẽ thử lại".

### Story 5: Mã lượt cố định trong file phiên (P2)

Người dùng hoặc model cần trỏ tới "lượt 5 của phiên S1". Họ muốn số lượt đó luôn chỉ đúng một lượt, kể cả sau dòng cụt, lượt lưu bù hay mở lại phiên (K5).

- **Vì sao ưu tiên này:** file phiên là bằng chứng của những gì model đã thấy (C10 B10). Muốn trỏ tới một lượt trong file (khi tra lại, khi báo lượt chưa lưu, khi giai đoạn lịch sử tra theo lượt) thì số lượt phải ghi trong file, vì đếm thứ tự dòng sai khi có dòng cụt (T2) hoặc khi dòng chỉ mục lệch (K5). Mức P2 vì Story 1–4 không cần số lượt mới chạy được.
- **Kiểm độc lập:** ghi phiên qua các ca lỗi của spec 004, đọc lại, so số lượt.

**Kịch bản nghiệm thu:**

1. **Cho** phiên mới, ba lượt ghi bình thường,
   **khi** đọc lại file,
   **thì** ba lượt mang mã 1, 2, 3.
2. **Cho** lượt 1 ghi lỗi rồi được lưu bù ở lượt 2 (Story 1 của spec 004),
   **khi** đọc lại,
   **thì** lượt lưu bù mang mã 1, lượt sau mang mã 2. Câu báo "Đã lưu bù lượt 1" và mã trong file là cùng một số.
3. **Cho** phiên có 2 lượt, cuối file có một dòng cụt (tắt ngang),
   **khi** mở lại và gửi lượt mới,
   **thì** lượt mới mang mã 3.
4. **Cho** phiên ghi bằng bản trước spec này (không có mã lượt), 4 lượt,
   **khi** mở lại và gửi lượt mới,
   **thì:**
   - lịch sử mở lại giống hệt như trước bản sửa;
   - bốn lượt cũ được coi là lượt 1–4 theo thứ tự;
   - lượt mới mang mã 5.
5. **Cho** dòng chỉ mục của phiên ghi số lượt cũ hơn file (lần ghi chỉ mục trước bị lỗi), file có 6 lượt,
   **khi** mở lại và gửi lượt mới,
   **thì** lượt mới mang mã 7, lấy theo file chứ không theo dòng chỉ mục.

### Story 6: `memory_read` trả câu ngắn khi khối đã có (P3)

Model gọi `memory_read` bài học 7 lần thứ hai trong phiên, trong khi khối #7 bản 1 vẫn còn trong lịch sử. Người dùng muốn không tốn token gửi lại khối (ADR 0002 mục 6).

- **Vì sao ưu tiên này:** chỉ tiết kiệm token. Spec 002 cố ý trả khối đầy đủ vì khi đó sổ chưa biết chắc khối còn trong lịch sử; spec này cho sổ biết chắc.
- **Kiểm độc lập:** gọi tool qua model giả hai lần, ở hai lượt.

**Kịch bản nghiệm thu:**

1. **Cho** lượt 1 đã đọc #7 bản 1 bằng `memory_read`,
   **khi** lượt 3 model gọi lại `memory_read` bài học 7,
   **thì** kết quả là "Bài học #7 bản 1 đã có phía trên trong hội thoại, ở khối có nhãn [Memory · bài học · #7 · bản 1 · …]; nội dung không đổi." Câu trỏ bằng nhãn khối mà model thấy, không bằng số lượt: lịch sử gửi model không đánh số lượt, nên model không tìm được "lượt 1".
2. **Cho** như trên nhưng #7 đã có bản 2,
   **khi** gọi lại,
   **thì** kết quả là khối đầy đủ bản 2.
3. **Cho** khối #7 nằm trong một kết quả tool cũ mà lõi đang bỏ ra khỏi request hiện tại (dọn kết quả tool khi gần ngưỡng context),
   **khi** gọi lại,
   **thì** kết quả là khối đầy đủ, vì model không còn thấy khối đó.
4. **Cho** khối #7 bản 1 chỉ còn trong phần lịch sử giữ lại sau một lần nén,
   **khi** gọi lại,
   **thì** kết quả là đúng câu ở kịch bản 1. Mọi ca dùng một câu duy nhất.

## 3. Tình huống biên và lỗi

**Quan hệ với bộ ghi phiên của spec 004.** Dòng che đi qua cùng bộ ghi phiên, không có đường ghi riêng:

- **Append-only.** Dòng che là **một dòng mới nối vào cuối file**. Không dòng nào đã được báo là đã lưu bị sửa hay xoá. Ngoại lệ duy nhất vẫn là ngoại lệ của spec 004: cắt file về đúng kích thước trước một lần ghi lỗi.
- **Thứ tự.** Dòng che xếp vào cùng hàng chờ, sau các lượt đang chờ. Vì vậy dòng che luôn nằm **sau** những lượt nó che, kể cả khi các lượt đó đang chờ lưu bù.
- **Lượt đang chờ.** Lượt đang chờ lưu bù được ghi đúng như model đã thấy (bất biến 8): không che nội dung lượt đó trước khi ghi. Dòng che nằm sau nó sẽ che khi đọc lại.
- **Ghi lỗi.** Ghi dòng che lỗi (kể cả lỗi giữa chừng rồi cắt lại) thì dòng che chờ ghi bù như mọi phần khác. Biên nhận và câu báo theo spec 004.
- **Không cắt lại được.** Cắt lại cũng lỗi thì file phiên ngừng nhận ghi (spec 004), nên dòng che không vào file được. Mọi lần đọc lại vẫn che theo kho (YC-008).
- **Tắt ngang.** App tắt khi dòng che còn chờ thì dòng che mất; dòng che bị cắt dở thì bị bỏ qua khi đọc (spec 004). Hai trường hợp đều được che lại nhờ YC-008.
- **Lượt chưa xuống đĩa.** Phiên chưa có lượt nào trên đĩa mà người dùng xoá một mục có khối trong lượt đang chờ: dòng che xếp sau lượt đó trong hàng, ghi cùng lần.

**Kho và nhận diện mục:**

- **Chỉ ghi dòng che khi kho xác nhận.** Dòng che là vĩnh viễn trong file, nên chỉ được ghi khi kho đọc được **và** xác nhận mục đã bị xoá (kho giữ dấu mục đã xoá) hoặc không còn trong kho đó.
- **Không có file kho, hoặc kho không đọc được** (file hỏng, lược đồ mới hơn, người dùng chuyển file kho ra chỗ khác như spec 005 hướng dẫn khi kho hỏng): không biết mục nào đã xoá.
  - Dòng che đã có trong file vẫn được áp.
  - Mọi khối memory còn lại **tạm che** trong những gì gửi model hoặc xuất ra.
  - Không ghi dòng che nào vào file.
  - Người dùng được báo, mỗi ca một câu: "Không tìm thấy kho memory; các khối memory trong phiên này tạm được che cho tới khi có lại kho." hoặc "Kho memory không đọc được: <lý do>; các khối memory trong phiên này tạm được che." Câu chỉ hiện khi phiên **có** khối bị tạm che. Phiên không có khối memory nào (ví dụ người chưa từng dùng sổ, không có file kho) thì im lặng, không có câu báo nào.
  - Kho có lại hoặc đọc được lại thì các khối chưa xoá hiện lại nguyên văn (Story 3 kịch bản 6).
- **Quan hệ với spec 005.** Ở phiên đang mở, kho đọc lỗi thì lượt mới **bị hoãn** theo spec 005 (thử lại, chạy tiếp không có ràng buộc, huỷ), trước khi có request nào. Vì vậy tạm che chỉ gặp ở:
  - lượt người dùng chọn "Chạy lượt này không có ràng buộc": request có khối đã tạm che cùng dòng báo của spec 005 (Story 3 kịch bản 7);
  - mở lại phiên;
  - `/export`;
  - tool đọc phiên cũ của agent chính.

  Thử lại mà đọc được kho thì lượt chạy với các khối bình thường.
- **Tên hiển thị đổi.** Mục đổi tên hiển thị sau khi khối đã gửi (bí danh HPG thôi dùng, chủ đề nay hiện là HPX). Xoá luận điểm của chủ đề đó vẫn che khối cũ mang tên HPG.
- **Kho được tạo lại.** Người dùng xoá file kho rồi tạo kho mới, nên số #7 có thể thuộc một mục khác. Khối cũ mang nhãn #7 không thuộc kho hiện có, nên được coi là không còn trong kho đó và bị che. Không gửi nhầm nội dung cũ như thể là của mục mới, kể cả khi kho được tạo lại trong cùng ngày.

**Nhận diện khối:**

- **Nhãn giả.** Chữ trông như nhãn memory nằm trong tin nhắn người dùng gõ, trong kết quả tool khác (trang web, tin tức), hay trong câu trả lời của model **không** được tính là khối có trong lịch sử, và không bao giờ bị che hay thay. Chỉ khối do memory đưa vào qua hai kênh của nó mới được tính: phần nhắc nhở memory và kết quả `memory_read`. Như vậy một trang web chứa dòng "[Memory · luận điểm · HPG · bản 3 …]" không làm sổ tưởng khối HPG đã có rồi bỏ không chèn.
- **Câu trả lời của model đã chép nội dung.** Câu trả lời ở lượt 2 có nhắc lại nội dung #7 thì không được che, vì không có nhãn. Câu báo xoá nói rõ điều này (Story 4).

**Che và lịch sử:**

- **Prompt cache.** Che làm đổi lịch sử, nên prompt cache vỡ một lần ở lượt sau khi xoá. Chấp nhận, vì xoá hiếm (ADR 0002 "Hệ quả").
- **Nhiều mục bị xoá cùng lúc** (xoá liền ba mục trước lượt sau): mỗi mục một dòng che, hoặc một dòng che cho cả ba; đọc lại che đủ cả ba.
- **Xoá giữa lúc đang có câu trả lời chạy.** Lượt đang chạy không đổi, kể cả các bước còn lại của nó. Che áp từ **lượt sau**, khớp câu báo "Từ lượt sau…" (Story 4). Lượt đang chạy được ghi đúng như model đã thấy, dòng che xếp sau nó (Story 2 kịch bản 7).
- **Phần giữ lại sau nén.** Khối nằm trong phần lịch sử giữ lại sau một lần nén cũng được che khi xoá và khi đọc lại, vì phần đó là lịch sử gửi model. Spec này không đổi cách nén. Chữ trong **bản tóm tắt** do model viết không mang nhãn, nên không che được: thuộc spec 007.

**Mã lượt:**

- **Lượt bị bỏ rồi gửi lại** (lỗi "hội thoại quá dài") không tốn một mã. Chỉ lượt kết thúc và được đưa vào hàng ghi mới có mã.
- **Hai cửa sổ cùng mở lại và cùng ghi tiếp một phiên:** ngoài phạm vi, như spec 004. Mã lượt có thể trùng trong ca này.

## 4. Yêu cầu

### Yêu cầu chức năng

**Danh sách nhãn trong lịch sử**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-001 | Trước khi memory quyết định phần nhắc nhở của một lượt, lõi PHẢI đưa cho memory danh sách các dòng do memory đưa vào đang có trong lịch sử sẽ gửi ở lượt đó, gồm khối có nhãn, dòng nhắc và dòng trỏ. Với mỗi khối: loại, mục, số bản, kênh (nhắc nhở hay kết quả `memory_read`); mã lượt chỉ khi plan thấy cần | Q1, ADR 0002 đợt đầy đủ và mục 2, §B3 mục 2, C11 (C-4) |
| YC-002 | Danh sách nhãn PHẢI chỉ gồm dòng nằm trong hai kênh của memory (phần nhắc nhở memory, kết quả `memory_read`). Chữ giống nhãn ở tin nhắn người dùng, kết quả tool khác hay câu trả lời của model KHÔNG được tính | Bất biến 3; K3 |
| YC-003 | Sổ ghi nhớ PHẢI quyết định chèn, không chèn, chèn bản mới kèm "thay cho", gửi hay không gửi dòng nhắc, dòng trỏ, dựa trên danh sách nhãn. Không dựa vào trí nhớ tạm của phiên. Cùng lịch sử và cùng kho thì cùng quyết định, dù app vừa khởi động lại, phiên vừa mở lại, hay sổ vừa tắt rồi bật lại | Q1, ADR 0002 mục 2–4; giới hạn 1 của spec 002 |
| YC-004 | Mỗi thay đổi (bản mới, đổi trạng thái, xoá) của một mục có khối trong lịch sử PHẢI được nhắc đúng một lần **so với lịch sử**: dòng nhắc đã có trong lịch sử thì không gửi lại, kể cả sau khi mở lại phiên | ADR 0002 mục 4, C10 B9 |

**Che khi xoá**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-005 | Khi một mục bị xoá (luận điểm, bài học), lõi PHẢI thay **mọi khối của mục đó, mọi bản**, trong lịch sử của phiên đang mở bằng dòng `[Memory · <loại> #<số> đã bị người dùng xoá]` trước **lượt** kế tiếp. Lượt đang chạy lúc xoá không đổi, kể cả các bước còn lại của nó. Chỉ khối đó bị thay; phần còn lại của tin nhắn hay kết quả tool giữ nguyên từng byte | Q1, ADR 0002 mục 5, §B3 mục 5, C8, C10 B9 |
| YC-006 | YC-005 PHẢI áp cả khi việc xoá xảy ra ở cửa sổ khác: phiên đang mở ở cửa sổ này được che trước lượt kế tiếp của nó | C10 B9; §3 C3 "Kho đổi bởi cửa sổ khác" (spec 002) |
| YC-007 | Mỗi lần che trong một phiên, lõi PHẢI xếp một dòng che vào file của phiên đó qua bộ ghi phiên. Dòng che nêu mục bị che, không chép nội dung. Dòng che là dòng mới nối cuối file; không dòng nào đã báo là đã lưu bị sửa | ADR 0002 mục 5, C3 (loại dòng "Che"), bất biến 8; spec 004 YC-002, YC-018 |
| YC-008 | Mọi đường đọc phiên (mở lại phiên, tool đọc phiên cũ của agent chính, `/export`, xem lại lịch sử trên màn hình) PHẢI che: (a) mọi khối nằm trước một dòng che của mục đó trong file; (b) khi kho đọc được: mọi khối của mục mà kho xác nhận đã bị xoá hoặc không còn trong kho đó, dù file chưa có dòng che; (c) khi không có file kho hoặc kho không đọc được: tạm che mọi khối memory còn lại theo YC-010 | ADR 0002 mục 5, C10 B9; người dùng chốt 05/11/2026 (che mọi phiên khi đọc) |
| YC-009 | Dòng che chỉ được ghi khi kho đọc được **và** xác nhận mục đã bị xoá hoặc không còn trong kho đó. Khi mở lại một phiên và (b) của YC-008 che thêm khối, lõi PHẢI nối dòng che tương ứng vào file đó và báo người dùng số mục đã che. Các đường chỉ đọc (tool đọc phiên cũ, `/export`) KHÔNG được ghi vào file | YC-007; bất biến 8 |
| YC-010 | Không có file kho, hoặc kho không đọc được, khi mở lại hay đọc một phiên, hoặc ở lượt người dùng chọn chạy tiếp không có ràng buộc (spec 005): lõi PHẢI vẫn áp dòng che có trong file, **tạm che** mọi khối memory khác trong những gì gửi model hoặc xuất ra, KHÔNG ghi dòng che nào, và báo người dùng bằng câu riêng cho từng ca ("không tìm thấy kho memory", "kho memory không đọc được: <lý do>"). Câu báo chỉ hiện khi có ít nhất một khối bị tạm che; không có khối nào thì không báo. Kho có lại hoặc đọc được lại thì khối chưa xoá hiện lại nguyên văn | Quy ước "thiếu dữ liệu phải hiện ra"; C8; C10 B9; spec 005 (hoãn lượt) |
| YC-011 | Che PHẢI nhận ra mọi khối của mục kể cả khi tên hiển thị của mục đã đổi sau khi khối được gửi | Q7 (ID nội bộ, tên là bí danh) |

**Câu báo**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-012 | Câu báo khi xoá trong `/memory` PHẢI nói "đã xoá khỏi ứng dụng"; với mục có thể nằm trong lịch sử (luận điểm, bài học), PHẢI nói model không còn nhận nội dung, kể cả trong lịch sử và khi mở lại phiên cũ; PHẢI nói câu trả lời trước của model có thể đã nhắc lại; PHẢI nói bản đã gửi provider không thu hồi được. KHÔNG được có chữ hứa xoá vật lý ("vĩnh viễn", "hoàn toàn", "khỏi máy") | Bất biến 8; ADR 0002 mục 5 và "Mất và rủi ro"; C8 |
| YC-013 | Ghi dòng che lỗi PHẢI được báo theo cách báo lỗi ghi phiên của spec 004, tách khỏi câu báo xoá; câu báo xoá không đổi vì lỗi đó | Spec 004 YC-003; YC-008 |

**Mã lượt**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-014 | Mỗi lượt ghi vào file phiên PHẢI mang một mã lượt: số nguyên tăng dần trong phiên, gán khi lượt được đưa vào hàng ghi, giữ nguyên khi lưu bù | K5, C3 (dòng "Mở đầu, kết thúc lượt"), C11 (C-1) |
| YC-015 | Mở lại phiên thì mã lượt tiếp theo PHẢI tính từ file (mã lớn nhất cộng một; với lượt không có mã thì đếm lượt theo thứ tự), không từ dòng chỉ mục | K5, T2 |
| YC-016 | Số lượt trong các câu báo ghi phiên của spec 004 PHẢI trùng mã lượt trong file | K5; spec 004 YC-003 |

**`memory_read` và định dạng**

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-017 | `memory_read` PHẢI trả một câu ngắn duy nhất, trỏ bằng nhãn khối mà model thấy (không bằng số lượt), ví dụ "Bài học #7 bản 1 đã có phía trên trong hội thoại, ở khối có nhãn [Memory · bài học · #7 · bản 1 · …]; nội dung không đổi.", khi đúng bản đó đang nằm trong phần lịch sử model thấy ở bước này. Khối bị lõi bỏ ra khỏi request (dọn kết quả tool cũ) thì không tính, và tool trả khối đầy đủ | ADR 0002 mục 6, §B3 mục 6 |
| YC-018 | Phiên ghi trước spec này PHẢI mở lại được, lịch sử giống hệt trước. Phiên ghi bằng spec này PHẢI mở được ở phiên bản app trước đó mà không lỗi định dạng (dòng mới bị bỏ qua) | Spec 004 YC-017 (tinh thần tương thích); C3 |
| YC-019 | Nội dung khối, dòng che và danh sách nhãn KHÔNG được làm lộ quyết định: quyết định không bao giờ có khối trong lịch sử, nên không có trong danh sách nhãn hay dòng che | C10 B3, ADR 0006 |

### Thực thể chính

- **Danh sách nhãn:** những dòng memory đã đưa vào phần lịch sử sẽ gửi ở một lượt, gồm khối có nhãn (loại, mục, số bản, kênh; mã lượt nếu plan thấy cần), dòng nhắc và dòng trỏ. Lõi dựng từ lịch sử thật, không lưu riêng.
- **Dòng che:** một dòng trong file phiên, model không thấy. Nói "che mọi khối của mục X nằm phía trên". Có thời điểm ghi, có loại và số của mục, không có nội dung.
- **Mã lượt:** số nguyên của một lượt trong phiên, ghi trong file cùng lượt đó, không đổi sau khi ghi.
- **Khối đã che:** dòng `[Memory · <loại> #<số> đã bị người dùng xoá]` đứng ở chỗ khối cũ trong những gì gửi model và hiển thị.

## 5. Tiêu chí thành công

| Mã | Tiêu chí đo được | Kiểm bằng |
| --- | --- | --- |
| TC-001 | Story 1 kịch bản 1–6: sau khi bỏ hết trạng thái tạm (mô phỏng khởi động lại) rồi mở lại phiên, khối không chèn lặp; bản mới chèn kèm "thay cho"; dòng nhắc đúng một lần và không lặp sau lần mở lại thứ hai; lượt gửi lại sau lỗi "hội thoại quá dài" có khối | `bun test` |
| TC-002 | Cùng lịch sử và cùng kho, phần memory của request khi phiên chạy liền và khi phiên được mở lại sau khởi động lại giống hệt từng byte | `bun test` |
| TC-003 | Story 2 kịch bản 1–8: sau khi xoá, không request nào **của các lượt sau** chứa chuỗi đánh dấu của mục đã xoá; các khối khác và phần còn lại của tin nhắn giống hệt từng byte; xoá ở cửa sổ khác cũng che; xoá giữa lượt thì các request còn lại của lượt đó giống hệt như khi không xoá | `bun test` |
| TC-004 | Story 3 kịch bản 1–5 (6, 7 ở TC-007): qua mở lại phiên, tool đọc phiên cũ, `/export`, không chỗ nào chứa chuỗi đánh dấu; phiên cũ chưa có dòng che được nối dòng che khi mở lại, không bị ghi khi chỉ đọc; dòng che không áp cho khối nằm sau nó | `bun test` |
| TC-005 | Tìm chuỗi đánh dấu: với một nhãn giả nằm trong tin nhắn người dùng và trong kết quả một tool khác, khối thật của chủ đề đó vẫn được chèn, và nhãn giả không bị che hay thay | `bun test` |
| TC-006 | Quan hệ với spec 004: (a) dòng che ghi lỗi rồi được ghi bù, đứng sau lượt nó che; (b) lượt đang chờ lưu bù có khối #7, xoá #7, ghi bù: file có lượt nguyên văn rồi dòng che, đọc lại thì che; (c) file ngừng nhận ghi: mở lại vẫn che theo kho; (d) mọi dòng có trước trong file không đổi byte nào (so trước và sau) | `bun test` |
| TC-007 | Story 3 kịch bản 6, 7: không có file kho hoặc kho không đọc được (lúc mở lại, `/export`, tool đọc phiên cũ, lượt chạy tiếp không có ràng buộc): request và bản xuất không chứa nội dung khối memory nào, có câu báo đúng ca, file phiên không đổi byte nào. Trả file kho về rồi mở lại: khối chưa xoá giống hệt từng byte như lần gửi đầu; khối đã xoá bị che và có dòng che mới. Ca im lặng: không có file kho, mở lại một phiên không có khối memory nào thì không có câu báo nào, request giống hệt như khi có kho | `bun test` |
| TC-008 | Story 4 kịch bản 1–3: câu báo có đủ các ý bắt buộc, không có chữ hứa xoá vật lý; ghi dòng che lỗi không đổi câu báo xoá | `bun test` (giao diện headless) |
| TC-009 | Story 5 kịch bản 1–5: mã lượt đúng qua ghi bình thường, lưu bù, dòng cụt, phiên cũ không có mã, chỉ mục lệch; câu báo lưu bù dùng cùng số | `bun test` |
| TC-010 | Story 6 kịch bản 1–4: câu ngắn duy nhất, trỏ bằng nhãn khối, khi bản đó có trong phần model thấy (kể cả phần giữ lại sau nén); khối đầy đủ khi bản mới hơn hoặc khi kết quả cũ bị bỏ ra khỏi request | `bun test` |
| TC-011 | Tương thích: phiên mẫu ghi trước spec này mở lại có lịch sử giống hệt; file có dòng che và mã lượt đọc bằng bộ đọc của bản trước không lỗi | `bun test` |
| TC-012 | Không request, không kết quả tool, không dòng che nào chứa nội dung quyết định (chuỗi đánh dấu trong lý do quyết định) | `bun test` |
| TC-013 | Typecheck sạch; toàn bộ `bun test` xanh ở máy và trên CI Windows, Ubuntu; test spec 002, 004 hiện có chỉ đổi kỳ vọng ở chỗ spec này đổi hành vi (câu báo xoá, câu ngắn của `memory_read`, giới hạn đã gỡ) | `bun run typecheck`, `bun test`, CI |

## 6. Đối chiếu bất biến

| Bất biến | Spec giữ thế nào |
| --- | --- |
| Chỉ đọc | Không thêm tool. `memory_read` vẫn chỉ đọc |
| Quyền do code quyết định | Che và danh sách nhãn do lõi và sổ quyết định theo kho. Chữ trong tin nhắn, tool, trang web không tạo được nhãn và không kích hoạt che (YC-002, TC-005) |
| Output bên ngoài là dữ liệu không tin cậy | Nhãn giả ở kênh khác không được tính (YC-002); nội dung memory vẫn được escape như spec 002 |
| Bí mật | Dòng che và câu báo chỉ có loại, số mục, số lượt, lỗi hệ thống; không có nội dung memory hay khoá |
| Test không chạm mạng và `~/.opentrading` thật | Thư mục dữ liệu tạm, model giả, `fetch` giả |
| Không bịa số | Không thêm số liệu. Câu ngắn của `memory_read` chỉ trỏ tới khối đã có, không tóm lại nội dung |
| Chỉ người dùng làm memory có hiệu lực; model không có tool ghi | Che chỉ xảy ra sau thao tác xoá của người dùng trong `/memory` (hoặc khi đọc thấy mục đã xoá trong kho). Model không có đường nào gây che hay xoá |
| Lịch sử phiên append-only; xoá là che, không hứa xoá vật lý | Dòng che là dòng nối thêm; không dòng nào đã báo là đã lưu bị sửa (YC-007, TC-006 d). Lượt đang chờ được ghi đúng như model đã thấy. Câu báo nói "đã xoá khỏi ứng dụng", nói rõ provider không thu hồi được, không hứa xoá vật lý (YC-012) |
| Quyết định không tự vào context | Quyết định không có khối nên không vào danh sách nhãn hay dòng che (YC-019, TC-012) |
| Agent con không nhận memory, không có tool lịch sử | Không đổi. Agent con không nhận lịch sử của agent chính nên không có danh sách nhãn |
| Thiếu dữ liệu phải nói ra | Kho không đọc được thì tạm che và báo, không coi như "không có gì bị xoá" (YC-010). Ghi dòng che lỗi được báo (YC-013) |

## 7. Điểm đụng lõi

| Phần lõi | Cần thay đổi gì, vì sao | Nhãn |
| --- | --- | --- |
| Lưu và đọc phiên | Thêm loại dòng che và mã lượt vào file phiên; mã lượt tiếp theo tính từ file khi mở lại; mọi đường đọc phiên áp dòng che và hỏi kho mục nào đã xoá (YC-007, YC-008, YC-010, YC-014–YC-016, YC-018). Vì K3, K5, C10 B9 | `blocked-by-core` |
| Vòng agent và hợp đồng `MemoryProvider` | Đưa danh sách nhãn từ lịch sử sẽ gửi cho memory trước khi memory quyết định phần nhắc nhở; cho `memory_read` biết khối nào đang trong phần model thấy ở bước này; che khối trong lịch sử đang mở trước lượt kế tiếp; tạm che ở lượt chạy tiếp không có ràng buộc (YC-001–YC-006, YC-010, YC-017). Hợp đồng đổi, nên cần chủ repo duyệt và có thể cần ghi vào tài liệu hợp đồng | `blocked-by-core` |
| Giao diện phiên (mở lại phiên, xoá trong `/memory`) | Khi xoá: che lịch sử đang mở, xếp dòng che, báo. Khi mở lại: nối dòng che cho khối che thêm theo kho, báo số mục đã che hoặc báo kho không đọc được (YC-005, YC-009, YC-010, YC-013) | `blocked-by-core` |
| Tool đọc phiên cũ của agent chính, `/export` | Đọc qua bộ đọc phiên có che; không ghi file (YC-008, YC-009) | `blocked-by-core` |

Không đụng: phần nén hội thoại (spec 007), `FileMemory` (giữ nguyên, gỡ ở spec 007), agent con, khoá file.

Phần thuộc memory (không phải lõi): sổ ghi nhớ quyết định theo danh sách nhãn thay cho trí nhớ tạm; câu báo xoá trong `/memory`; câu ngắn của `memory_read`.

**Việc phải ghi trong mô tả PR:** spec này đổi hợp đồng `MemoryProvider` (thêm danh sách nhãn) và định dạng file phiên (thêm dòng che, mã lượt). Bản app cũ mở file mới vẫn chạy nhưng không che (YC-018).

## 8. Phạm vi

**Trong phạm vi:**
- Story 1 tới 6, YC-001 tới YC-019.
- Gỡ hai giới hạn của bản tối thiểu ghi ở `specs/README.md`: khối chèn lại hoặc thiếu sau khi mở lại phiên; xoá chưa che.
- Đổi câu báo xoá của sổ ghi nhớ theo YC-012.

**Ngoài phạm vi** (kể cả các mục "Để sau" liên quan):
- **Toàn bộ phần nén hội thoại** (người dùng chốt 05/11/2026), thuộc spec 007:
  - mẫu tóm tắt chỉ giữ nhãn, không chép nội dung khối;
  - mục "Ràng buộc và sở thích" của bản tóm tắt;
  - che chữ đã chép vào bản tóm tắt;
  - báo cho memory lúc vừa nén.

  Spec này không sửa phần nén. Sau nén, danh sách nhãn tự ngắn lại theo lịch sử thật, nên khối được chèn lại ở bản hiện hành khi chủ đề còn tập trung. Rủi ro còn lại tới khi xong 007: bản tóm tắt có thể chép nội dung khối mà không kèm nhãn.
- **Thẻ gợi ý và dòng thẻ:** spec 007.
- **Gỡ `FileMemory`:** spec 007. Spec này không sửa memory cũ; memory cũ không có khối có nhãn nên không bị che.
- **Ngân sách memory theo phiên, thu gọn khối của chủ đề không còn tập trung** (§B3 mục 9): đo rồi mới làm.
- **Dựng lại chủ đề đang tập trung từ lịch sử khi mở lại phiên.** Sau khi mở lại, chủ đề tập trung bắt đầu từ lượt mới. Khối đã có vẫn nằm trong lịch sử nên model không thiếu nội dung.
- **Che chữ trong câu trả lời của model** đã nhắc lại nội dung mục bị xoá: không có nhãn để nhận ra. Câu báo nói rõ.
- **Xoá vật lý** nội dung trong file phiên hay trong kho (dọn trang trống SQLite, viết lại file phiên): không làm. Bất biến 8 chỉ đòi che.
- **Tra phiên theo mã lượt trong tool lịch sử, tool lịch sử đọc file agent con và nhật ký ultradesk:** giai đoạn lịch sử (C-8, C12 giai đoạn 4).
- **Thu hồi chia sẻ quyết định** (C8 dòng 2): chia sẻ quyết định thuộc "Để sau".
- **Luật đoạn dán dài:** chưa có spec nhận. Không gộp vào thay đổi hợp đồng của spec này, để giữ phạm vi.
- **Hai cửa sổ cùng mở lại và cùng ghi tiếp một phiên:** như spec 004.
- **Để sau (§C13):** mã gõ sai; chủ đề xuất hiện giữa lượt; ISIN; chế độ "chỉ ghi nhận" và Cedar; bộ đo với model thật.
- **Đã bỏ:** `/memory quet`.

## 9. Giả định

- Mục có thể nằm trong lịch sử là luận điểm và bài học. Ràng buộc và cách trình bày chỉ nằm ở phần hệ thống, dựng lại mỗi request, nên xoá chúng không cần che. `memory_read` hiện không đọc ràng buộc. Nếu sau này đọc, YC-005 áp luôn.
- Màn hình đang hiện: chữ đã in trên terminal không xoá được. Che áp cho những gì gửi model và cho mọi lần hiển thị lại từ lịch sử (mở lại, xuất, xem lại).
- Đổi trạng thái và sửa (bản mới) không che. Bản cũ vẫn nằm trong lịch sử kèm dòng "thay cho" hoặc dòng nhắc, như spec 002 (ADR 0002 mục 3).
- Hỏi kho "mục nào đã xoá" khi mở lại một phiên dùng quyền đọc của người dùng, nên không đi qua bảng chính sách của vai model. Kết quả chỉ là danh sách số mục, không có nội dung.
- Ràng buộc đọc độc lập với công tắc memory (spec 005), nên kho được đọc cả khi sổ đang tắt. Khi sổ tắt, YC-008 vẫn che khi mở lại phiên. Không có file kho thì không xác nhận được mục nào đã xoá: phiên không có khối memory nào thì không đổi gì; phiên có khối memory (ví dụ file kho bị chuyển đi) thì tạm che theo YC-010, không ghi dòng che.
- Định dạng chính xác của dòng che, mã lượt, danh sách nhãn và câu chữ cuối của câu báo chốt ở plan. Các câu trong spec là mẫu để test so.
- Kiểm "kho cho biết mục đã xoá" chạy một lần khi mở lại hay đọc một phiên, và một lần mỗi lượt cho phiên đang mở (dựa vào cơ chế phát hiện kho đổi của spec 002). Không đọc lại toàn bộ kho khi kho không đổi.

## 10. Kiểm chất lượng

**Tự kiểm vòng 1 (bản nháp, 05/11/2026):**

| Mục | Kết quả |
| --- | --- |
| Không có chi tiết cài đặt (tên hàm, file, SQL) | Đạt. Chỉ nhắc tên người dùng thấy (`/memory`, `/export`, `/config`, `memory_read`) và tên hợp đồng `MemoryProvider` ở §7 để chủ repo biết phần nào đổi |
| Mọi yêu cầu kiểm thử được, không mơ hồ | Đạt. Mỗi YC có kịch bản hoặc TC; che kiểm bằng chuỗi đánh dấu |
| Mọi yêu cầu dẫn nguồn | Đạt |
| Mỗi user story có Cho/Khi/Thì với ví dụ cụ thể | Đạt |
| Có tình huống biên và lỗi | Đạt (§3: quan hệ với bộ ghi phiên spec 004, ghi lỗi, ngừng ghi, tắt ngang, kho không đọc được, tên đổi, kho tạo lại, nhãn giả, cache, nén) |
| Phạm vi có giới hạn, có "Ngoài phạm vi" | Đạt; toàn bộ phần nén sang 007 |
| Không mâu thuẫn "Đã chốt" hay bất biến | Đạt. Che ở mọi phiên khi đọc rộng hơn chữ ADR 0002 (chỉ nói phiên đang mở) nhưng cùng hướng với C10 B9; người dùng chốt 05/11/2026 |
| Điểm đụng lõi liệt kê, gắn `blocked-by-core` | Đạt: 4 dòng |
| Không quá 3 chỗ `[CẦN LÀM RÕ]` | Đạt: 0 chỗ. Hai câu đã hỏi và người dùng trả lời 05/11/2026 (ranh giới với 007; phạm vi che) |

**Vòng 2 (06/11/2026, sau duyệt cổng 1 vòng 1):**
- Dòng che chỉ ghi khi kho đọc được và xác nhận mục đã xoá hoặc không còn trong kho đó. Không có file kho hoặc kho không đọc được thì tạm che, không ghi, báo bằng câu riêng cho từng ca. Lý do: dòng che là vĩnh viễn, ghi khi kho vắng thì khối chưa xoá bị che mãi sau khi người dùng trả file kho về. Sửa §3, YC-008, YC-009, YC-010, §9, TC-007; thêm Story 3 kịch bản 6.
- Câu ngắn của `memory_read` trỏ bằng nhãn khối, một câu cho mọi ca, vì model không thấy số lượt. Sửa Story 6 kịch bản 1, 4, YC-017, TC-010; Story 5 đổi lý do; YC-001 để plan quyết có cần mã lượt trong danh sách nhãn.
- Xoá giữa lượt thì lượt đang chạy không đổi, che từ lượt sau, để kiểm được bằng một test xác định và khớp câu báo. Sửa YC-005, YC-006, §3, TC-003; thêm Story 2 kịch bản 7.
- Thêm quan hệ với spec 005 ở §3 (kho lỗi thì lượt bị hoãn; tạm che chỉ gặp ở bốn chỗ) và Story 3 kịch bản 7.
- Ca tạo lại kho: bỏ căn cứ "khác ngày ghi bản", nói rõ kể cả tạo lại trong cùng ngày; cách nhận diện để plan chọn.

Kiểm lại 9 mục: đạt cả 9.

**Sửa nhỏ sau cổng 1 vòng 2 (06/11/2026, người dùng duyệt spec):** câu báo tạm che ("Không tìm thấy kho memory…", "Kho memory không đọc được…") chỉ hiện khi phiên có khối bị tạm che; phiên không có khối memory nào thì im lặng. Lý do: người chưa từng dùng sổ ghi nhớ không có kho, và không nên thấy câu này mỗi lần mở lại phiên. Sửa §3, YC-010, TC-007 (thêm ca im lặng).
