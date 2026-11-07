# Spec 001: Kho memory và bảng chính sách theo loại

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (01/11/2026, qua cổng 1 sau khi sửa R50–R52). Đã code (01/11/2026): `implemented`, test chạy trên máy; chưa nối vào app (spec 002); chờ duyệt code, CI |
| **Ngày tạo** | 01/11/2026 |
| **Nhánh** | `feat/memory` |
| **Mô tả gốc** | "kho memory.db và bảng chính sách theo loại (spec 001 trong specs/README.md)" (lộ trình `specs/README.md`, thứ tự 3) |
| **Dựa trên** | Quyết định Q2, Q4, Q6, Q7; vấn đề T4, T5, H4, H5, H7, H8; giải pháp §B5, §B6 "Quyết định S", §B8; kiến trúc v5.1 mục C2, C3, C8, C10 (B3, B4, B6, B7) (`docs/memory/ra-soat-v5.md`); ADR 0003, 0006 |

## 1. Bối cảnh và mục tiêu

Memory v5.1 cần một kho để mọi spec sau (002 đường đọc, 003 đường ghi, 005 agent con) dựa vào. Theo ADR 0003, kho là một file SQLite trong thư mục dữ liệu, dùng SQLite có sẵn trong Bun. Theo ADR 0006, việc mỗi loại memory được đi đâu do một bảng chính sách khai báo quyết định.

Spec này làm **phần nền, chưa có giao diện**:
- kho mở được an toàn, có phiên bản lược đồ, không bao giờ ghi đè kho do bản app mới hơn tạo;
- ghi và đọc năm loại memory (ràng buộc, cách trình bày, luận điểm theo chủ đề, bài học, quyết định), có phiên bản, chống ghi đè, ID không dùng lại, xoá logic;
- bảng chính sách theo loại, và một cổng đọc duy nhất hỏi bảng đó.

Các lỗi được giải quyết từ gốc: ID và số bản bị dùng lại, chống ghi đè sai mốc, quyết định gắn sai căn cứ (T5); mất trường lạ khi đọc rồi ghi lại (T4); mỗi khối tự kiểm loại memory (H5).

Người dùng **chưa thấy gì thay đổi** sau spec này. Kho chưa được nối vào app; việc nối thuộc spec 002 và 003.

## 2. User story và kịch bản nghiệm thu

Người dùng cuối chưa thao tác trực tiếp với kho ở spec này. Các story viết theo điều người dùng sẽ thấy khi spec 002, 003 dùng kho. Mọi kịch bản kiểm được bằng `bun test` trên thư mục tạm.

### Story 1: Kho mở an toàn và không bao giờ phá kho của bản app khác (P1)

Người dùng có thể chạy hai bản OpenTrading khác nhau trên cùng thư mục dữ liệu (ví dụ bản cũ và bản mới sau khi cập nhật). Họ muốn kho không bao giờ bị bản cũ làm hỏng, và khi kho không mở được thì được báo rõ lý do, file vẫn còn nguyên.

- **Vì sao ưu tiên này:** mất kho là mất toàn bộ ràng buộc, luận điểm, nhật ký quyết định. Mọi spec sau dựa vào việc mở kho.
- **Kiểm độc lập:** mở kho trên thư mục tạm với các file chuẩn bị sẵn; không cần phần nào khác.

**Kịch bản nghiệm thu:**

1. **Cho** thư mục dữ liệu chưa có kho, **khi** app mở kho, **thì** kho được tạo với lược đồ bản 1, rỗng, và mở lại lần hai không đổi gì.
2. **Cho** một kho có lược đồ bản 2 (do bản app mới hơn tạo) trong khi app chỉ hiểu tới bản 1, **khi** app mở kho, **thì:**
   - mở thất bại với câu báo "Kho memory do phiên bản OpenTrading mới hơn tạo (lược đồ bản 2, bản này hiểu tới bản 1). Kho được giữ nguyên.";
   - nội dung file kho giống hệt từng byte trước khi mở;
   - kết nối đã đóng: xoá thư mục tạm ngay sau đó thành công, kể cả trên Windows.
3. **Cho** một file kho hỏng (ví dụ file văn bản "không phải SQLite"), **khi** app mở kho, **thì** mở thất bại, câu báo nêu đường dẫn file và lỗi, file giữ nguyên, kết nối đã đóng.
4. **Cho** một kho bản 1 tạo bởi một lần chạy trước, có ràng buộc "Không dùng margin", **khi** mở lại, **thì** đọc được đúng ràng buộc đó, không chạy lại bước tạo lược đồ.

### Story 2: Ràng buộc và cách trình bày có ID, phiên bản, phạm vi (P1)

Người dùng lưu ràng buộc như "Không dùng margin", "Tối đa 20% danh mục cho một mã". Họ muốn mỗi ràng buộc có ID ổn định, sửa thì giữ được lịch sử, và hai cửa sổ cùng sửa thì không mất bản của ai.

- **Vì sao ưu tiên này:** ràng buộc là loại memory quan trọng nhất (luôn gửi cho agent chính và agent con, không bao giờ cắt). Q4 chuyển ràng buộc vào kho có cấu trúc.
- **Kiểm độc lập:** ghi và đọc trực tiếp qua kho.

**Kịch bản nghiệm thu:**

1. **Cho** kho rỗng, **khi** lưu ràng buộc "Không dùng margin", **thì** được ràng buộc ID 1, bản 1, phạm vi "mọi tài khoản", nguồn "gõ tay", có ngày giờ lưu.
2. **Cho** ràng buộc ID 1 bản 1, **khi** sửa thành "Không dùng margin, kể cả T+0" với mốc "đang sửa từ bản 1", **thì** có bản 2; đọc bản 1 vẫn ra văn bản cũ; bản hiện hành là bản 2.
3. **Cho** ràng buộc ID 1 đang ở bản 2, và cửa sổ A, cửa sổ B cùng mở form từ bản 2, **khi** A lưu bản 3 rồi B lưu với mốc "đang sửa từ bản 2", **thì** B bị từ chối với lỗi xung đột, kèm văn bản bản 3 hiện có (để giao diện của spec 003 hiện diff); kho chỉ có bản 3 của A.
4. **Cho** các ràng buộc đang có hiệu lực tổng 1.450 ký tự, **khi** lưu thêm một ràng buộc 80 ký tự, **thì** bị từ chối vì vượt tổng 1.500 ký tự, nêu tổng hiện có và giới hạn; không có gì được lưu, không có câu nào bị cắt.
5. **Cho** cách trình bày "Trả lời ngắn, có bảng", **khi** đọc bằng cổng đọc cho agent con, **thì** không có cách trình bày đó (Story 6).
6. **Cho** ba lần thay đổi bất kỳ vào bộ ràng buộc (thêm, sửa, xoá), **khi** đọc phiên bản bộ ràng buộc, **thì** con số tăng sau mỗi lần và không bao giờ giảm. Thay đổi cách trình bày không làm số này tăng.

### Story 3: Luận điểm gắn chủ đề có ID nội bộ; số bản không bao giờ đánh lại (P1)

Người dùng viết luận điểm cho HPG với các điều kiện "Sai nếu". Mã có thể đổi, người dùng có thể xoá rồi viết lại. Họ muốn các tham chiếu cũ ("HPG bản 2") không bao giờ trỏ nhầm sang nội dung khác.

- **Vì sao ưu tiên này:** T5 và Q7. Quyết định (Story 5) và lịch sử phiên tham chiếu "chủ đề, bản"; đánh số lại là trỏ nhầm.
- **Kiểm độc lập:** ghi, đổi bí danh, xoá, tạo lại qua kho.

**Kịch bản nghiệm thu:**

1. **Cho** kho rỗng, **khi** tạo chủ đề loại "mã" với bí danh "HPG", thuộc chủ đề ngành "Thép", rồi lưu luận điểm "Hưởng lợi từ đầu tư công" với điều kiện (1) "Sai nếu biên gộp dưới 10% hai quý liền", (2) "Sai nếu tồn kho tăng quá 30%", hạn xem lại 31/12/2026, **thì** chủ đề có ID nội bộ, luận điểm bản 1, trạng thái "đang theo dõi", hai điều kiện giữ đúng thứ tự.
2. **Cho** HPG bản 3 hiện hành, **khi** lưu bản 4 với mốc "đang sửa từ bản 3", **thì** bản 3 có "hiện hành đến" bằng thời điểm bản 4 bắt đầu hiện hành; bản 4 hiện hành; bản 3 vẫn đọc được nguyên văn.
3. **Cho** chủ đề HPG, **khi** thêm bí danh "HPG2" (giả sử mã đổi), **thì** tra "HPG" và "HPG2" đều ra cùng một chủ đề; lịch sử bí danh ghi ngày thêm. Không có chủ đề mới.
4. **Cho** chủ đề khác đang dùng bí danh "HSG", **khi** thêm bí danh "HSG" cho HPG, **thì** bị từ chối, nêu chủ đề đang dùng bí danh đó.
5. **Cho** HPG đã có bản 1 tới 3, **khi** xoá luận điểm HPG rồi viết luận điểm HPG mới, **thì** luận điểm mới là **bản 4**, không phải bản 1; đọc "HPG bản 2" trả "đã xoá", không trả nội dung bản 4.
6. **Cho** HPG bản 4, **khi** đổi trạng thái sang "đã bị bác bỏ" với mốc "đang ở bản 4", **thì** trạng thái và ngày đổi được lưu, không tạo bản mới.
7. **Cho** luận điểm có 9 điều kiện, hoặc văn bản dài hơn 350 ký tự, **khi** lưu, **thì** bị từ chối, nêu trường nào vượt và giới hạn; bản trước giữ nguyên.

### Story 4: Bài học có bản (P2)

Người dùng ghi bài học "Định giá ngân hàng: dùng P/B, không dùng P/E", áp dụng cho ngành ngân hàng, có ngoại lệ.

- **Vì sao ưu tiên này:** spec 002 dựng mục lục từ tiêu đề bài học, `memory_read` trả bài học theo bản. Thấp hơn Story 1–3 vì cùng cơ chế phiên bản đã kiểm ở đó.
- **Kiểm độc lập:** ghi và đọc bài học qua kho.

**Kịch bản nghiệm thu:**

1. **Cho** kho có chủ đề ngành "Ngân hàng", **khi** lưu bài học tiêu đề "Định giá ngân hàng", tóm tắt "Dùng P/B và ROE, không dùng P/E", áp dụng cho ngành "Ngân hàng", ngoại lệ "Ngân hàng đang tái cơ cấu", tag "định giá", **thì** được bài học #1 bản 1.
2. **Cho** bài học #7 bản 1, **khi** sửa với mốc "đang sửa từ bản 1", **thì** có bản 2; bản 1 đọc lại được nguyên văn.
3. **Cho** bài học có tiêu đề 121 ký tự, **khi** lưu, **thì** bị từ chối, nêu giới hạn 120.

### Story 5: Quyết định ghi nối, gắn đúng căn cứ lúc người dùng xem (P1)

Người dùng ghi "Mua HPG" sau khi xem luận điểm HPG bản 2. Họ muốn quyết định luôn nhớ đúng bản đã xem và bộ ràng buộc lúc đó, kể cả khi luận điểm vừa được sửa ở cửa sổ khác.

- **Vì sao ưu tiên này:** T5 (quyết định gắn bản lúc ghi, không phải bản đang xem), bất biến C10 B6.
- **Kiểm độc lập:** ghi quyết định qua kho với các mốc chuẩn bị sẵn.

**Kịch bản nghiệm thu:**

1. **Cho** HPG bản 2 hiện hành và phiên bản bộ ràng buộc là 5, **khi** ghi quyết định việc "Mua HPG", lý do "Biên gộp hồi phục", căn cứ "HPG bản 2", **thì** quyết định D1 lưu đúng căn cứ "HPG bản 2" và "bộ ràng buộc bản 5", có ngày giờ.
2. **Cho** form quyết định hiển thị HPG bản 2, nhưng trước khi lưu cửa sổ khác đã lưu bản 3, **khi** ghi quyết định với căn cứ "HPG bản 2", **thì** D2 vẫn gắn "HPG bản 2" (bản người dùng đã xem), không tự đổi thành bản 3. (Hỏi người dùng chọn bản nào là việc của form, spec 003.)
3. **Cho** căn cứ "HPG bản 9" không tồn tại, hoặc bản đã bị xoá, **khi** ghi quyết định, **thì** bị từ chối, không có gì được lưu.
4. **Cho** quyết định D1, **khi** tìm cách sửa nội dung D1, **thì** không có thao tác nào làm được việc đó; chỉ có thêm quyết định mới hoặc xoá D1.
5. **Cho** việc ghi quyết định gặp lỗi giữa chừng (mô phỏng), **khi** kiểm kho, **thì** không có quyết định nào nửa vời: hoặc đủ quyết định kèm cả hai căn cứ, hoặc không có gì.
6. **Cho** D1 gắn "HPG bản 2", **khi** luận điểm HPG bị xoá, **thì** D1 vẫn còn, căn cứ hiện "HPG bản 2 (đã xoá)"; nội dung bản 2 không được chép vào D1 để né việc xoá.
7. **Cho** chủ đề VNM đã có trong kho nhưng chưa có luận điểm, **khi** ghi quyết định việc "Bán VNM", lý do "Cơ cấu danh mục", không đưa căn cứ, **thì** D3 được lưu với căn cứ "không có luận điểm" và phiên bản bộ ràng buộc lúc ghi. Ghi quyết định cho chủ đề chưa có trong kho (ví dụ "MWG" chưa tạo) thì bị từ chối, không có gì được lưu.

### Story 6: Bảng chính sách theo loại và một cổng đọc duy nhất (P1)

Người dùng muốn nhật ký quyết định không bao giờ bị gửi cho model, và agent con chỉ nhận ràng buộc. Nhóm muốn một chỗ duy nhất để đọc và sửa luật này, và quên luật ở đường đọc mới thì test đỏ.

- **Vì sao ưu tiên này:** Q6, H5, bất biến C10 B3. K9 xảy ra vì mỗi khối tự kiểm loại memory.
- **Kiểm độc lập:** tạo một mục cho mỗi loại, hỏi cổng đọc với mọi tổ hợp vai và hành động, đối chiếu bảng.

**Kịch bản nghiệm thu:**

1. **Cho** kho có đúng một mục mỗi loại: ràng buộc "Không dùng margin", cách trình bày "Trả lời ngắn", luận điểm HPG bản 1, bài học #1 "Định giá ngân hàng", quyết định D1 "Mua HPG", **khi** đọc qua cổng với vai "agent con", hành động "đọc vào request", **thì** chỉ nhận ràng buộc "Không dùng margin".
2. **Cho** kho như trên, **khi** đọc qua cổng với **mọi** tổ hợp vai của model (agent chính, agent con) và hành động (vào phần hệ thống, vào mục lục, vào khối có nhãn, đọc qua `memory_read`) trong bối cảnh "chưa chia sẻ", **thì** không lần nào trả nội dung "Mua HPG" hay lý do của D1.
3. **Cho** kho như trên, **khi** đọc với vai "agent chính", hành động "vào mục lục", **thì** nhận "HPG" (chỉ tên mã, không văn bản luận điểm) và "#1 Định giá ngân hàng" (chỉ tiêu đề, không tóm tắt); không nhận ràng buộc, cách trình bày, quyết định.
4. **Cho** một tổ hợp bảng không khai báo (ví dụ một vai mới "máy chủ MCP"), **khi** hỏi cổng, **thì** bị từ chối (mặc định không cho).
5. **Cho** bảng chính sách, **khi** hỏi "ai được làm cho mục có hiệu lực", **thì** với mọi loại chỉ có vai "người dùng"; không vai nào của model (agent chính, agent con) có hành động này.

## 3. Tình huống biên và lỗi

- **Kho bận:** tiến trình khác giữ quyền ghi lâu hơn thời gian chờ thì lần ghi báo "kho memory đang bận, thử lại" trong thời gian chờ ngắn hơn mọi thời gian chờ của giao diện (hiện ngắn nhất là 2 giây khi đổi phiên và khi thoát); không treo, không ghi một phần.
- **Hai tiến trình cùng ghi** (hai cửa sổ): không lần ghi nào mất âm thầm; lần ghi trùng mốc phiên bản bị từ chối như Story 2 kịch bản 3.
- **Kho đổi bởi tiến trình khác:** kho cho biết "đã có thay đổi từ lần đọc trước" mà không phải đọc lại mọi bảng, để bộ đệm mục lục của spec 002 làm mới đúng lúc.
- **Mở lỗi giữa chừng** (lược đồ mới hơn, file hỏng, không có quyền đọc, lỗi khi tạo lược đồ): kết nối được đóng ngay; file giữ nguyên, trừ trường hợp kho vừa được tạo mới trong chính lần mở đó và chưa có dữ liệu.
- **Tạo lược đồ lỗi giữa chừng:** không để lại kho nửa lược đồ; lần mở sau tạo lại từ đầu hoặc báo lỗi, không coi kho nửa vời là bản 1.
- **Windows giữ khoá file:** sau khi đóng kho, xoá được file kho và các file phụ của SQLite ngay; test xoá thư mục tạm không gặp `EBUSY`.
- **Xoá một mục đã xoá, hoặc sửa một mục đã xoá:** bị từ chối, nêu "đã xoá"; không hồi sinh mục.
- **Mốc phiên bản sai khi xoá:** xoá cũng phải khớp bản hiện hành (§B5); lệch thì từ chối như xung đột.
- **Văn bản có ký tự đặc biệt** (xuống dòng, `</memory>`, dấu nháy, chữ có dấu tiếng Việt, emoji): lưu và đọc lại đúng từng ký tự. Kho không escape; việc escape khi đưa vào prompt thuộc spec 002.
- **Giới hạn ký tự đếm theo ký tự người đọc thấy**, không theo byte: "Hòa Phát" là 8 ký tự.
- **Văn bản rỗng hoặc chỉ khoảng trắng:** bị từ chối ở mọi trường bắt buộc.
- **Khoá bí mật trong văn bản** (ví dụ ràng buộc "dùng key sk-ant-api03-…"): kho từ chối lần ghi, nêu trường bị chặn, câu báo không chép chuỗi khoá (YC-031). Người dùng chốt 01/11/2026: kho chặn, để mọi đường ghi hiện tại và sau này đều được che.

## 4. Yêu cầu

### Yêu cầu chức năng

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-001 | Hệ thống PHẢI lưu memory v5.1 trong một kho SQLite duy nhất, dùng SQLite có sẵn trong Bun, không thêm dependency | Q2, ADR 0003 |
| YC-002 | Hệ thống PHẢI mở kho từ đường dẫn hoặc kết nối được truyền **tường minh**; không có đường nào tự trỏ tới thư mục dữ liệu thật | ADR 0003 "Thiết lập"; bất biến test |
| YC-003 | Kho PHẢI ghi phiên bản lược đồ. Kho chưa có thì tạo lược đồ bản 1; kho bản cũ hơn thì nâng qua các bước nâng cấp có thứ tự, mỗi bước trong một transaction | C3 "Thông tin kho"; §B6 |
| YC-004 | Gặp kho có lược đồ mới hơn bản app hiểu, hoặc file không phải kho hợp lệ, hệ thống PHẢI từ chối mở, giữ nguyên file, đóng kết nối và báo lỗi nêu đường dẫn và lý do | C3, C8 "Lược đồ mới hơn bản app" |
| YC-005 | Mọi lỗi khi mở kho PHẢI đóng kết nối trước khi báo lỗi; kho PHẢI có thao tác đóng để app gọi khi tắt app hoặc tắt memory | ADR 0003; C3 "Đóng kết nối"; C13 rủi ro Windows |
| YC-006 | Kho PHẢI cho nhiều tiến trình cùng mở; mỗi lần ghi là một transaction ghi ngay; thời gian chờ quyền ghi ngắn hơn mọi thời gian chờ của giao diện, hết hạn thì báo "đang bận" | ADR 0003; C3 "Thiết lập" |
| YC-007 | Kho PHẢI cho biết đã có thay đổi từ kết nối khác kể từ lần kiểm trước, không cần đọc lại dữ liệu | C3 "làm mới bộ đệm"; §B6 |
| YC-008 | Mọi ID (ràng buộc, chủ đề, bài học, quyết định) PHẢI không bao giờ được cấp lại, kể cả sau khi mục bị xoá | T5, §B5, C10 B7 |
| YC-009 | Mỗi lần sửa ràng buộc, cách trình bày, luận điểm, bài học PHẢI tạo bản mới với số bản tăng; bản đã ghi không bao giờ bị sửa nội dung (chỉ bị xoá nội dung khi xoá cả mục) | ADR 0003 "Định danh"; C3 |
| YC-010 | Chủ đề PHẢI giữ "số bản cuối" của luận điểm, không bao giờ giảm, kể cả khi luận điểm bị xoá; luận điểm viết lại đánh số tiếp | T5, §B5, C3 |
| YC-011 | Mọi lần sửa, đổi trạng thái và xoá PHẢI kèm mốc "bản đang sửa"; chỉ thành công khi đó vẫn là bản hiện hành. Lệch thì từ chối, không ghi gì, trả bản hiện hành để giao diện hiện diff | T5, §B5, C4 bước 4–5, C8 |
| YC-012 | Ràng buộc và cách trình bày PHẢI có loại (ràng buộc / cách trình bày), phạm vi (bản đầu chỉ dùng "mọi tài khoản"), trạng thái; mỗi bản có văn bản, nguồn, ngày giờ | Q4, H8, C3 |
| YC-013 | Kho PHẢI có "phiên bản bộ ràng buộc": một số chỉ tăng, tăng sau mỗi lần thêm, sửa hoặc xoá một ràng buộc (không tính cách trình bày) | C3 "Quyết định", C4 bước 4 |
| YC-014 | Chủ đề PHẢI có ID nội bộ, loại (mã / ngành / thị trường), chủ đề ngành (với loại mã, tuỳ chọn), cờ "chỉ khớp khi viết hoa", trạng thái luận điểm (đang theo dõi / đã bị bác bỏ / đã đóng) kèm ngày đổi | Q7, H7, C3 |
| YC-015 | Bí danh PHẢI có lịch sử (ngày thêm, ngày thôi dùng); một bí danh đang dùng chỉ trỏ tới một chủ đề; tra chủ đề theo bí danh không phân biệt hoa thường; đổi mã là thêm bí danh, không tạo chủ đề | Q7, H2, H7, §B5 |
| YC-016 | Bản luận điểm PHẢI có văn bản, chi tiết, danh sách điều kiện "Sai nếu" có thứ tự, hạn xem lại (tuỳ chọn), "hiện hành từ", "hiện hành đến", nguồn; bản mới hiện hành thì bản trước được đóng "hiện hành đến" bằng đúng thời điểm đó | C3, §B5 "Thời gian hiệu lực" |
| YC-017 | Bản bài học PHẢI có tiêu đề, tóm tắt, áp dụng cho (danh sách chủ đề mã hoặc ngành), ngoại lệ, chi tiết, tag, nguồn, ngày giờ | C3 |
| YC-018 | Quyết định PHẢI ghi nối: có chủ đề (bắt buộc, phải tồn tại), việc, lý do, căn cứ luận điểm **tuỳ chọn** (bản luận điểm do bên gọi đưa, tức bản người dùng đã xem; không đưa thì ghi "không có luận điểm"), phiên bản bộ ràng buộc lúc ghi, các ô tuỳ chọn (kỳ vọng, mức tự tin, ngày xem lại, điều gì làm đổi ý), nguồn, ngày giờ. Không có thao tác sửa quyết định | C3, C4 bước 4, §B5, §B9 |
| YC-019 | Ghi quyết định PHẢI là một transaction: kiểm chủ đề tồn tại; nếu có căn cứ thì kiểm bản luận điểm đó thuộc chủ đề, tồn tại và chưa bị xoá; đọc phiên bản bộ ràng buộc; ghi quyết định. Lỗi ở bất kỳ bước nào thì không có gì được lưu | C10 B6, ADR 0003; R51 (người dùng chốt 01/11/2026) |
| YC-020 | Xoá PHẢI là xoá logic trong một transaction: xoá nội dung mọi bản của mục, giữ ID, số bản và các tham chiếu tới mục; mọi lần đọc sau trả "đã xoá" cho mục và mọi bản của nó, không trả nội dung | ADR 0003 "Xoá", C3, C8 |
| YC-021 | Quyết định tham chiếu một bản luận điểm đã xoá PHẢI vẫn đọc được, căn cứ hiện "đã xoá"; kho không chép nội dung luận điểm vào quyết định | C8; T5 |
| YC-022 | Kho PHẢI chỉ chứa mục đã có hiệu lực. Không có trạng thái "đề xuất" trong kho; đề xuất (thẻ gợi ý) không nằm trong kho | Bất biến 7; C3 "RAM" |
| YC-023 | Thao tác ghi và thao tác đọc PHẢI được cấp tách riêng: thành phần chỉ được cấp quyền đọc (đường đọc cho model ở spec 002) không có cách nào gọi thao tác ghi | Bất biến 7; C10 B4 |
| YC-024 | Kho PHẢI từ chối lần ghi vượt giới hạn trong bảng tham số của memory, nêu trường, giá trị và giới hạn, không cắt văn bản. Giới hạn bản đầu theo C2: ràng buộc mỗi mục 200, tổng các ràng buộc đang có hiệu lực 1.500; cách trình bày tổng 1.000; luận điểm văn bản 350, chi tiết 4.000, tối đa 8 điều kiện mỗi điều kiện 160; bài học tiêu đề 120, tóm tắt 320, chi tiết 4.000; quyết định việc 120, lý do 2.000 | C2 cột "Giới hạn"; H4 |
| YC-025 | Hệ thống PHẢI có **một bảng chính sách khai báo** theo hình dạng: vai đọc kho (người dùng, agent chính, agent con) · hành động (vào phần hệ thống, vào mục lục, vào khối có nhãn, đọc qua `memory_read`, đề xuất, làm cho có hiệu lực) · loại memory · bối cảnh (đã chia sẻ hay chưa). Mỗi ô cho biết được hay không, và với mục lục là phần nào được hiện (tên mã, tiêu đề). Tổ hợp không khai báo thì không cho | Q6, ADR 0006 mục 2–4, C2 |
| YC-026 | Nội dung bảng PHẢI khớp C2 và ADR 0006: ràng buộc vào phần hệ thống của agent chính và agent con; cách trình bày vào phần hệ thống chỉ của agent chính; luận điểm vào mục lục (tên mã) và khối có nhãn; bài học vào mục lục (tiêu đề) và `memory_read`; quyết định không vào đâu với mọi vai của model khi chưa chia sẻ; chỉ vai "người dùng" làm cho có hiệu lực; đề xuất bằng thẻ chỉ cho ràng buộc, cách trình bày, bài học | C2, ADR 0006, C10 B3 |
| YC-027 | Kho PHẢI có **một cổng đọc theo chính sách**: nhận vai, hành động, bối cảnh; trả đúng các mục và trường bảng cho phép. Mọi đường đọc cho model ở các spec sau PHẢI đi qua cổng này | Q6, H5, ADR 0006 mục 2 |
| YC-028 | Bộ test duyệt bảng PHẢI tạo một mục mỗi loại, gọi cổng đọc với mọi tổ hợp vai × hành động × bối cảnh, và đối chiếu với bảng. Các spec sau thêm đường đọc mới thì thêm vào cùng bộ test này | ADR 0006 mục 5, C10 B3 |
| YC-029 | Đọc rồi ghi lại không bao giờ được làm mất dữ liệu đang có trong kho do bản app khác ghi (không có "bỏ trường lạ rồi ghi đè") | T4 |
| YC-030 | Mọi thời điểm lưu trong kho PHẢI là thời điểm tuyệt đối có múi giờ, để khối memory của spec 002 ghi được "ngày tuyệt đối" | C10 B1 |
| YC-031 | Kho PHẢI từ chối mọi lần ghi có trường văn bản chứa mẫu khoá bí mật có độ chắc cao (khoá API của các provider đang hỗ trợ); câu báo nêu trường bị chặn, không chép chuỗi khoá. Không chặn số liệu hay chữ khác bằng mẫu | H3; bất biến bí mật; người dùng chốt 01/11/2026 |

### Thực thể chính

- **Ràng buộc:** ID, loại (ràng buộc hoặc cách trình bày), phạm vi, trạng thái (có hiệu lực / đã xoá), bản hiện hành. Có nhiều **bản ràng buộc**: số bản, văn bản, nguồn (gõ tay; thẻ đã xác nhận và nhập từ `INVESTOR.md` dùng ở spec sau), ngày giờ.
- **Phiên bản bộ ràng buộc:** một số chỉ tăng của kho.
- **Chủ đề:** ID nội bộ, loại, chủ đề ngành, cờ "chỉ khớp khi viết hoa", số bản cuối, trạng thái luận điểm kèm ngày. Có nhiều **bí danh** có lịch sử.
- **Bản luận điểm:** thuộc một chủ đề; số bản, văn bản, chi tiết, điều kiện có thứ tự, hạn xem lại, hiện hành từ / đến, nguồn.
- **Bài học:** ID, trạng thái, bản hiện hành. Có nhiều **bản bài học**: tiêu đề, tóm tắt, áp dụng cho (chủ đề), ngoại lệ, chi tiết, tag, nguồn, ngày giờ.
- **Quyết định:** ID, chủ đề, việc, lý do, căn cứ tuỳ chọn (số bản luận điểm của chủ đề đó, hoặc "không có luận điểm"), phiên bản bộ ràng buộc, ô tuỳ chọn, nguồn, ngày giờ, trạng thái (có / đã xoá). Ghi nối.
- **Thông tin kho:** phiên bản lược đồ.
- **Bảng chính sách:** hằng số trong code memory, không nằm trong kho.

## 5. Tiêu chí thành công

| Mã | Tiêu chí đo được | Kiểm bằng |
| --- | --- | --- |
| TC-001 | Story 1 kịch bản 1–4: kho rỗng được tạo bản 1; kho bản 2 bị từ chối, file giống hệt từng byte; file hỏng bị từ chối, giữ nguyên; xoá thư mục tạm thành công ngay sau mỗi lần mở lỗi | `bun test` |
| TC-002 | Mỗi loại có ID (ràng buộc, chủ đề, bài học, quyết định): tạo 3 mục, xoá mục 3, tạo mục mới → ID là 4 | `bun test` |
| TC-003 | Story 3 kịch bản 5: luận điểm viết lại sau khi xoá có số bản tiếp theo; đọc bản cũ trả "đã xoá" | `bun test` |
| TC-004 | Hai tiến trình (tiến trình phụ thật, thư mục tạm chung) cùng sửa một ràng buộc từ cùng bản: đúng một lần thành công, lần kia nhận xung đột kèm bản hiện hành; kho có đúng một bản mới | `bun test` |
| TC-005 | Một tiến trình phụ giữ quyền ghi lâu hơn thời gian chờ: lần ghi ở tiến trình chính báo "đang bận" trong dưới 2 giây và kho không đổi | `bun test` |
| TC-006 | Story 5 kịch bản 1–7: quyết định gắn đúng bản đã xem và phiên bản bộ ràng buộc; căn cứ không tồn tại bị từ chối; không có căn cứ thì lưu "không có luận điểm"; chủ đề không tồn tại bị từ chối; lỗi giữa chừng không để lại gì; luận điểm bị xoá thì căn cứ hiện "đã xoá" | `bun test` |
| TC-007 | Sau khi xoá mỗi loại, không có đường đọc nào của kho (kể cả đọc theo số bản, tra theo bí danh, cổng đọc theo chính sách) trả về nội dung cũ | `bun test` |
| TC-008 | Test duyệt bảng (YC-028): với một mục mỗi loại, mọi tổ hợp vai × hành động × bối cảnh khớp bảng; không tổ hợp nào của vai model trả nội dung quyết định; tổ hợp không khai báo bị từ chối | `bun test` |
| TC-009 | Với mỗi giới hạn ở YC-024: đúng bằng giới hạn thì lưu được, vượt 1 ký tự thì bị từ chối và bản trước giữ nguyên | `bun test` |
| TC-010 | Văn bản có xuống dòng, `</memory>`, nháy, tiếng Việt có dấu, emoji đọc lại giống hệt | `bun test` |
| TC-011 | Ghi ở kết nối B thì kết nối A thấy "đã có thay đổi"; không ghi gì thì không thấy | `bun test` |
| TC-012 | Thành phần chỉ được cấp quyền đọc không có thao tác ghi nào (kiểm ở mức kiểu và ở lúc chạy) | `bun run typecheck`, `bun test` |
| TC-013 | Không test nào chạm thư mục dữ liệu thật; mọi kết nối được đóng trước khi xoá thư mục tạm; typecheck sạch; toàn bộ `bun test` xanh ở máy và trên CI Windows, Ubuntu | `bun run typecheck`, `bun test`, CI |
| TC-014 | Với mỗi loại có trường văn bản: ghi văn bản chứa khoá giả dạng khoá API bị từ chối, kho không đổi, câu báo và mọi output test không chứa chuỗi khoá giả; văn bản "Tối đa 20% danh mục, P/E dưới 15" vẫn lưu được | `bun test` |

## 6. Đối chiếu bất biến

| Bất biến | Spec giữ thế nào |
| --- | --- |
| Chỉ đọc (không đặt lệnh) | Không thêm tool nào. Quyết định là nhật ký người dùng tự ghi, không phải lệnh giao dịch |
| Quyền do code quyết định | Bảng chính sách là hằng số trong code, không đọc từ kho, prompt hay memory (YC-025). Nội dung memory không mở được quyền nào |
| Output bên ngoài là dữ liệu không tin cậy | Kho lưu nguyên văn, không diễn giải nội dung. Việc escape và bọc khi đưa vào prompt thuộc spec 002; TC-010 bảo đảm kho giữ đúng ký tự để spec 002 escape được |
| Bí mật | Kho nằm trong thư mục dữ liệu, không ghi khoá API. Câu báo lỗi chỉ nêu đường dẫn, trường và giới hạn, không chép văn bản người dùng. Kho từ chối văn bản chứa mẫu khoá bí mật (YC-031, TC-014) |
| Test không chạm mạng và `~/.opentrading` thật | Kho chỉ mở từ đường dẫn tường minh (YC-002); test dùng thư mục tạm; không gọi model |
| Không bịa số; memory không lưu giá, số liệu, dự báo | Kho không có trường số liệu thị trường. Theo H3, không chặn số bằng biểu thức chính quy; khối của spec 002 gắn nhãn "người dùng tự ghi" và ngày tuyệt đối (YC-030) |
| Chỉ hành động tin cậy của người dùng làm memory có hiệu lực; model không có tool ghi | Kho chỉ chứa mục có hiệu lực (YC-022); quyền ghi tách khỏi quyền đọc (YC-023); bảng chỉ cho vai "người dùng" làm cho có hiệu lực (YC-026). Spec này không có đường ghi nào cho model |
| Xoá là che, không hứa xoá vật lý | Xoá logic trong kho (YC-020). Che khối trong lịch sử phiên thuộc spec 006. Spec này không có câu báo cho người dùng; spec 003 dùng câu "đã ngừng dùng", không nói "đã xoá vĩnh viễn" |
| Quyết định không tự vào context | Bảng không cho vai model nào đọc quyết định khi chưa chia sẻ; cổng đọc duy nhất; test duyệt bảng (YC-026 tới YC-028, TC-008) |
| Agent con chỉ nhận ràng buộc | Bảng cho agent con chỉ ràng buộc (Story 6 kịch bản 1). Việc gửi thật thuộc spec 005 |
| Ràng buộc không bao giờ bị cắt | Kho từ chối ghi khi vượt giới hạn thay vì cắt (YC-024), nên bộ ràng buộc đã lưu luôn vừa giới hạn |
| Đọc lỗi phải hiện ra | Mở kho lỗi thì báo rõ, không trả kho rỗng (YC-004). Hoãn lượt khi không đọc được ràng buộc thuộc spec 002, 005 |

## 7. Điểm đụng lõi

Không có. Mọi thứ nằm trong phần memory mới và `test/`. Kho chưa được nối vào app:
- chọn provider v5.1 trong `/config`, mở kho trong thư mục dữ liệu, đóng kho khi tắt app hoặc tắt memory: spec 002 (đã ghi trong lộ trình là sửa lõi nhỏ);
- ghi qua form: spec 003.

## 8. Phạm vi

**Trong phạm vi:**
- Story 1 tới 6, YC-001 tới YC-031.
- Lược đồ bản 1, cơ chế nâng lược đồ (chỉ có bản 1 nên chưa có bước nâng nào chạy thật), từ chối lược đồ mới hơn.
- Bảng chính sách, cổng đọc theo chính sách, test duyệt bảng.
- Bảng tham số giới hạn của memory (chỉ các giới hạn ở YC-024).

**Ngoài phạm vi** (kể cả các mục "Để sau" liên quan):
- **Nối kho vào app** (`/config`, mở và đóng theo vòng đời app): spec 002.
- **Mục lục, khối có nhãn, chọn chủ đề từ chữ người dùng gõ, `memory_read`, escape khi đưa vào prompt:** spec 002. Spec này chỉ cung cấp cổng đọc.
- **Lệnh, form, diff khi xung đột, cảnh báo lệch ngăn, xuất Markdown:** spec 003.
- **Gửi ràng buộc cho agent con, hoãn lượt khi không đọc được ràng buộc:** spec 005.
- **Che khối trong lịch sử phiên khi xoá:** spec 006.
- **Thẻ gợi ý:** spec 007. Kho không có trạng thái "đề xuất".
- **Để sau (§C13, Q4, Q6, Q7, §B9):**
  - ISIN của chủ đề;
  - nhập ràng buộc cũ từ `INVESTOR.md` (giá trị nguồn "nhập từ INVESTOR.md" có sẵn nhưng chưa có đường nào dùng);
  - tra "bản luận điểm hiện hành tại ngày X" (kho đã lưu "hiện hành từ / đến" nên làm sau được, không đổi lược đồ);
  - đánh giá lại quyết định;
  - chia sẻ quyết định (bảng có cột bối cảnh "đã chia sẻ", nhưng không có ô nào cho phép và không có thao tác chia sẻ);
  - chế độ "chỉ ghi nhận" khi đổi chính sách, ghi phiên bản bảng vào phiên, chuyển sang Cedar;
  - mã gõ sai.
- **Giới hạn số lượng mục** (số chủ đề, bài học, quyết định, số bản mỗi chủ đề) của thiết kế v5: đó là giới hạn cho kho JSON, chưa cần với SQLite; đo rồi mới thêm.
- **Xoá chủ đề** (khác xoá luận điểm của chủ đề): chưa có. Chủ đề không chứa nội dung riêng tư ngoài bí danh.
- **Chỉ mục tìm kiếm toàn văn:** chỉ thêm khi đo thấy chậm (C7).

## 9. Giả định

- Cổng đọc của kho chỉ có các vai đọc kho: người dùng, agent chính, agent con. Tool lịch sử không đọc kho; nó đọc file phiên, nơi khối memory đã gửi model được lưu (ADR 0002). Cột "Tool lịch sử" của ADR 0006 do spec 004 (agent con không có tool lịch sử) và spec 006 (che khối khi xoá) bảo đảm, không do cổng đọc của kho.
- Tên file kho và vị trí trong thư mục dữ liệu theo ADR 0003; spec 002 mở kho ở đó. Spec này chỉ nhận đường dẫn tường minh.
- Thời gian chờ quyền ghi cụ thể được chốt ở plan, với ràng buộc dưới 2 giây (thời gian chờ ngắn nhất hiện có của giao diện, từ spec 004).
- "Phiên bản bộ ràng buộc" là một số đếm toàn kho, không phải danh sách bản của từng ràng buộc. Đủ để quyết định ghi "lúc ghi, bộ ràng buộc ở bản N"; muốn xem lại đúng bộ đó thì đọc các bản ràng buộc có ngày giờ không muộn hơn quyết định.
- Đổi trạng thái luận điểm không tạo bản mới, nhưng vẫn cần mốc bản hiện hành (YC-011).
- Bí danh tra không phân biệt hoa thường ở kho. Cờ "chỉ khớp khi viết hoa" chỉ có tác dụng khi spec 002 dò chủ đề trong chữ người dùng gõ.
- Kho chỉ có một người dùng (máy cá nhân), nên không có trường chủ sở hữu.
- File kho được tạo với quyền chỉ chủ tài khoản đọc ghi trên hệ có phân quyền kiểu POSIX, như file khoá API hiện nay; trên Windows dùng quyền mặc định của thư mục người dùng.
- Câu báo lỗi là tiếng Việt; câu chữ chính xác chốt ở plan.

## 10. Kiểm chất lượng

**Tự kiểm vòng 1 (bản nháp đầu, 01/11/2026):**

| Mục | Kết quả |
| --- | --- |
| Không có chi tiết cài đặt (tên hàm, file, SQL) | Đạt. Nhắc SQLite và Bun như ràng buộc đã chốt (ADR 0003); `memory_read` là tên tool đã chốt (Q3) |
| Mọi yêu cầu kiểm thử được, không mơ hồ | Đạt. Mỗi YC có TC hoặc kịch bản tương ứng |
| Mọi yêu cầu dẫn nguồn | Đạt |
| Mỗi user story có Cho/Khi/Thì với ví dụ cụ thể | Đạt |
| Có tình huống biên và lỗi | Đạt (§3: kho bận, hai tiến trình, Windows giữ khoá, mở lỗi, tạo lược đồ lỗi) |
| Phạm vi có giới hạn, có "Ngoài phạm vi" | Đạt |
| Không mâu thuẫn "Đã chốt" hay bất biến | Đạt |
| Điểm đụng lõi liệt kê, gắn `blocked-by-core` | Đạt: không có điểm đụng lõi |
| Không quá 3 chỗ `[CẦN LÀM RÕ]` | Đạt: 1 chỗ (chặn khoá bí mật, §3) |

**Vòng 2 (01/11/2026, sau khi người dùng trả lời):** người dùng chọn phương án A, kho chặn khoá bí mật. Thêm YC-031, TC-014; sửa §3 và §6. Kiểm lại 9 mục: đạt cả 9. Không còn chỗ `[CẦN LÀM RÕ]`.

**Vòng 3 (01/11/2026, sau cổng 1):**
- R50: cổng đọc chỉ có vai đọc kho; bỏ vai "tool lịch sử" khỏi Story 6 kịch bản 2 và YC-025; §9 ghi cột "Tool lịch sử" thuộc spec 004 và 006.
- R51: người dùng chốt căn cứ luận điểm của quyết định là tuỳ chọn, chủ đề bắt buộc; sửa YC-018, YC-019, TC-006, thực thể Quyết định; thêm Story 5 kịch bản 7.

Kiểm lại 9 mục: đạt cả 9. Trạng thái "Đã duyệt" theo lời người dùng.
