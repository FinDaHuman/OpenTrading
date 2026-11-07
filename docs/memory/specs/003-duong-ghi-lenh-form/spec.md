# Spec 003: Sổ ghi nhớ, đường ghi: lệnh và form

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (04/11/2026, qua cổng 1). Plan đã duyệt (cổng 2). Code xong 04/11/2026, chờ duyệt code (cổng 3) |
| **Ngày tạo** | 03/11/2026 |
| **Nhánh** | `feat/memory` |
| **Mô tả gốc** | "đường ghi của sổ ghi nhớ: lệnh và form (spec 003 trong specs/README.md)" (lộ trình `specs/README.md`, thứ tự 5) |
| **Dựa trên** | Quyết định Q4, Q6, Q7 (và Q1 ở phần dòng nhắc sau khi sửa); vấn đề K7, T5, T6, H3; giải pháp §B5, §B7; kiến trúc v5.1 mục C2, C3, C4, C8, C9 (tình huống A, B, E), C10 (B4, B5, B6, B7) (`docs/memory/ra-soat-v5.md`); ADR 0003, 0005 (mục 1, 6), 0006 |

## 1. Bối cảnh và mục tiêu

Spec 001 có kho `memory.db` với đủ thao tác ghi; spec 002 nối kho vào app thành lựa chọn "Sổ ghi nhớ" trong `/config`, cho model đọc và cho người dùng xem, xoá trong `/memory`. Nhưng người dùng **chưa ghi được gì vào sổ**: không có lệnh, không có form. Sổ chỉ có dữ liệu trong test.

Spec này làm **đường ghi**, chạy hoàn toàn tại máy, không gọi model:
- bốn lệnh `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh`, mỗi lệnh mở một form có ô có cấu trúc;
- `/memory` thêm sửa (mở lại đúng form, điền sẵn bản đang có), đổi trạng thái luận điểm, và xuất Markdown;
- form cảnh báo khi một câu có dạng ràng buộc đang được lưu thành bài học (K7);
- hai cửa sổ cùng sửa một mục thì cửa sổ lưu sau thấy chỗ khác nhau, không ghi đè (T5);
- lịch sử ô nhập chỉ lưu tên lệnh memory, ở cả đường gửi lẫn đường xoá ô (T6).

Sau spec này, cùng với 001 và 002, sổ ghi nhớ chạy trọn vòng ghi và đọc (mốc "dùng được" của lộ trình), với ba giới hạn đã ghi ở spec 002 §8.

## 2. User story và kịch bản nghiệm thu

**Kho ví dụ dùng chung** (giống spec 002, để nối được hai spec):
- ràng buộc #1 bản 2 "Không dùng margin, kể cả T+0"; ràng buộc #4 bản 1 "Tối đa 20% danh mục cho một mã"; phiên bản bộ ràng buộc là 5;
- cách trình bày #2 bản 1 "Trả lời ngắn, có bảng";
- chủ đề ngành "Thép" có luận điểm bản 2; chủ đề HPG (bí danh "HPG", "Hòa Phát", thuộc ngành Thép) có luận điểm bản 3 "Hưởng lợi từ đầu tư công", điều kiện (1) "Sai nếu biên gộp dưới 10% hai quý liền", (2) "Sai nếu tồn kho tăng quá 30%", hạn xem lại 31/12/2026, trạng thái "đang theo dõi";
- chủ đề VCB chưa có luận điểm; chủ đề ngành "Ngân hàng" chưa có luận điểm;
- chủ đề #9 loại mã, bí danh đang dùng "XYZ", từng có bí danh "ABC" (đã thôi dùng ngày 01/09/2026, khi mã đổi), chưa có luận điểm;
- bài học #7 bản 1 "Định giá ngân hàng", tóm tắt "Dùng P/B và ROE, không dùng P/E", áp dụng cho "Ngân hàng".

"Sổ ghi nhớ đang bật" nghĩa là `/config` đang chọn "Sổ ghi nhớ" và kho mở được. Mọi kịch bản kiểm được bằng `bun test` với giao diện headless, thư mục dữ liệu tạm và `fetch` giả đếm số request.

### Story 1: `/nho` lưu ràng buộc hoặc cách trình bày (P1)

Người dùng gõ `/nho Không dùng margin` và muốn câu đó thành ràng buộc luôn được áp dụng, không cần key model, không có gì rời máy.

- **Vì sao ưu tiên này:** ràng buộc là loại memory quan trọng nhất; đây là đường duy nhất để người dùng tạo ràng buộc (ADR 0005 mục 1).
- **Kiểm độc lập:** sổ rỗng, gõ lệnh, xác nhận form, đọc kho và request của lượt sau.

**Kịch bản nghiệm thu:**

1. **Cho** sổ ghi nhớ đang bật, kho ví dụ, **khi** gõ `/nho Không bán khống` rồi Enter, **thì** form "Ghi nhớ" mở ra với ô văn bản điền sẵn "Không bán khống", **chưa chọn ngăn nào**, kèm tiêu chí phân loại:
   ```
   Ngăn:  ( ) Ràng buộc — điều bạn không bao giờ muốn vi phạm; luôn gửi cho model, không bao giờ cắt
          ( ) Cách trình bày — bạn muốn câu trả lời trông thế nào
   Ràng buộc đang có (2 · 77/1.500 ký tự): #1 Không dùng margin, kể cả T+0 · #4 Tối đa 20% danh mục cho một mã
   ```
   Nút Xác nhận chưa dùng được khi chưa chọn ngăn.
2. **Cho** form trên, **khi** chọn "Ràng buộc" rồi Xác nhận, **thì** kho có ràng buộc #5 bản 1 "Không bán khống", nguồn "gõ tay"; phiên bản bộ ràng buộc lên 6; người dùng thấy "Đã lưu ràng buộc #5 (bản 1). Có hiệu lực từ lượt hỏi kế tiếp."; request của lượt hỏi kế tiếp có dòng "[#5 · bản 1] Không bán khống" trong phần hệ thống.
3. **Cho** form trên, **khi** chọn "Cách trình bày" rồi Xác nhận, **thì** kho có cách trình bày #5 bản 1; phiên bản bộ ràng buộc vẫn là 5.
4. **Cho** cả quá trình gõ lệnh, điền form, xác nhận ở kịch bản 2, **khi** đếm request mạng, **thì** có 0 request; quá trình chạy được khi chưa kết nối provider nào (C10 B5).
5. **Cho** các ràng buộc đang có tổng 1.450 ký tự, **khi** gõ một ràng buộc mới 80 ký tự, **thì** form hiện "1.530/1.500 ký tự" và không cho Xác nhận, kèm câu "Vượt tổng 1.500 ký tự cho ràng buộc. Rút gọn hoặc xoá bớt ràng buộc cũ trong /memory."; không có gì được lưu, không câu nào bị cắt.
6. **Cho** gõ `/nho` không kèm chữ, **khi** Enter, **thì** form mở với ô văn bản trống.
7. **Cho** ô văn bản chứa "dùng key sk-ant-api03-…" (khoá giả), **khi** Xác nhận, **thì** không lưu; form giữ nguyên, báo "Trường «văn bản» có chuỗi giống khoá bí mật (khoá API). Kho memory không lưu khoá; bỏ chuỗi đó rồi lưu lại."; câu báo, màn hình thông báo, lịch sử ô nhập và file phiên không chứa chuỗi khoá.
8. **Cho** ràng buộc "Không dùng margin, kể cả T+0" đã có, **khi** lưu ràng buộc "không dùng margin, kể cả t+0" (khác hoa thường, khoảng trắng), **thì** form cảnh báo "Trùng ràng buộc #1." và hỏi lại; người dùng vẫn lưu được nếu chọn lưu.
9. **Cho** chọn "Ràng buộc", **khi** form hiện, **thì** có dòng "Hiện ràng buộc chỉ gửi cho agent chính; agent con chưa nhận (sẽ có ở bản sau)." (giới hạn 3 của spec 002, gỡ ở spec 005).

### Story 2: Nội dung lệnh memory không rò ra ngoài form (P1)

Người dùng dán nhầm khoá API khi gõ `/nho`, hoặc gõ một luận điểm riêng tư. Họ muốn nội dung đó không nằm lại trong lịch sử ô nhập (bấm ↑ hay Ctrl+R không lấy lại được), kể cả khi xoá ô bằng Esc Esc hay Ctrl+C (T6).

- **Vì sao ưu tiên này:** lịch sử ô nhập là một file trên đĩa, giữ tới 1 triệu ký tự đoạn dán, không có kiểm khoá. T6 đã tái hiện: khoá dán nhầm nằm lại trong file.
- **Kiểm độc lập:** gõ lệnh theo từng đường, đọc file lịch sử ô nhập trong thư mục tạm.

**Kịch bản nghiệm thu:**

1. **Cho** sổ ghi nhớ đang bật, **khi** gõ `/nho Không dùng margin` rồi Enter, **thì** lịch sử ô nhập có thêm đúng một mục "/nho"; bấm ↑ ra "/nho".
2. **Cho** ô nhập đang có `/luandiem HPG Hưởng lợi từ đầu tư công` (chưa gửi), **khi** bấm Esc hai lần để xoá ô, **thì** lịch sử ô nhập có thêm "/luandiem", không có "HPG" hay "Hưởng lợi". Cùng kết quả khi xoá bằng Ctrl+C.
3. **Cho** ô nhập `/nho [Pasted text #1]` với đoạn dán 2.000 ký tự, **khi** Enter, **thì** form nhận đủ 2.000 ký tự (và báo vượt giới hạn 200 nếu chọn ràng buộc); lịch sử ô nhập chỉ có "/nho", không có đoạn dán.
4. **Cho** lệnh gõ hoa `/NHO Không dùng margin`, **khi** Enter, **thì** xử lý như `/nho`; lịch sử ô nhập chỉ có tên lệnh.
5. **Cho** câu chat thường "Phân tích HPG", **khi** gửi, **thì** lịch sử ô nhập vẫn lưu nguyên câu như hiện nay (spec này không đổi lệnh khác).
6. **Cho** model trả lời một câu có chữ "/nho Được dùng margin", **khi** câu trả lời xong, **thì** không form nào mở, kho không đổi (lệnh chỉ chạy từ chữ người dùng gõ vào ô nhập).
7. **Cho** quá trình ở kịch bản 1 tới khi xác nhận form, **khi** đọc file phiên đang mở, **thì** không có nội dung đã gõ trong form hay trong tham số lệnh (lệnh memory không phải một lượt hội thoại).

### Story 3: `/luandiem` lưu luận điểm theo bản (P1)

Người dùng gõ `/luandiem HPG` để viết hoặc sửa luận điểm HPG, có điều kiện "Sai nếu".

- **Vì sao ưu tiên này:** luận điểm là đường dùng memory chính của phân tích (spec 002 chèn khối luận điểm). Sửa phải tạo bản mới, không ghi đè (ADR 0003, T5).
- **Kiểm độc lập:** kho ví dụ, mở form, sửa, xác nhận, đọc kho.

**Kịch bản nghiệm thu:**

1. **Cho** kho ví dụ, **khi** gõ `/luandiem hpg`, **thì** form "Luận điểm HPG" điền sẵn bản 3: văn bản, hai điều kiện có số thứ tự, hạn xem lại 31/12/2026, chi tiết; đầu form ghi "Đang sửa từ bản 3".
2. **Cho** form trên, **khi** đổi điều kiện (2) thành "Sai nếu tồn kho tăng quá 25%" rồi Xác nhận, **thì** form trước khi lưu hiện chỗ khác nhau so với bản 3 (dòng cũ, dòng mới); xác nhận thì kho có bản 4, bản 3 "hiện hành đến" bằng lúc lưu; người dùng thấy "Đã lưu luận điểm HPG bản 4."
3. **Cho** kho không có chủ đề FPT, **khi** gõ `/luandiem FPT`, **thì** form "Luận điểm mới FPT" có thêm các ô của chủ đề: loại (mặc định "mã"; "ngành"; "thị trường"), ngành (chọn trong các chủ đề ngành đã có, hoặc gõ tên ngành mới), bí danh khác (ví dụ "FPT Corp"), "chỉ khớp khi viết hoa" (mặc định tắt); Xác nhận thì kho có chủ đề FPT và luận điểm **bản 1**.
4. **Cho** HPG đã từng có bản 1 tới 3 rồi luận điểm bị xoá, **khi** viết luận điểm HPG mới qua `/luandiem HPG`, **thì** đầu form ghi "Luận điểm mới (bản trước đã xoá)", lưu xong là **bản 4** (spec 001 YC-010).
5. **Cho** form có 8 điều kiện, **khi** thêm điều kiện thứ 9, **thì** form không cho thêm, nêu giới hạn 8; mỗi điều kiện hiện số ký tự trên 160.
6. **Cho** luận điểm HPG đang "đã bị bác bỏ", **khi** lưu bản mới, **thì** form báo trước khi xác nhận: "Lưu bản mới đưa trạng thái về «đang theo dõi»."
7. **Cho** `/luandiem` không kèm mã, **khi** Enter, **thì** form mở với ô mã trống; Xác nhận khi ô mã trống thì không được.
8. **Cho** form luận điểm, **khi** điều kiện là "Sai nếu giá về dưới 20.000 đồng" hoặc chi tiết có "dự báo lợi nhuận 2027 sẽ đạt 15.000 tỷ", **thì** form hiện cảnh báo, không chặn: "Có vẻ đây là giá hoặc dự báo. Sổ ghi nhớ không phải nguồn số liệu; model sẽ lấy số mới bằng tool. Vẫn lưu nếu đây là ngưỡng của bạn."; [Vẫn lưu] lưu được. Điều kiện "Sai nếu biên gộp dưới 10% hai quý liền" không có cảnh báo.
9. **Cho** kho ví dụ (chủ đề #9 từng có bí danh "ABC", nay là "XYZ"), **khi** gõ `/luandiem ABC`, **thì** form mở là "Luận điểm mới ABC" với các ô của chủ đề mới (như kịch bản 3), kèm câu "«ABC» từng là bí danh của chủ đề #9 (nay là XYZ), đã thôi dùng ngày 01/09/2026. Lưu sẽ tạo chủ đề mới ABC; muốn viết luận điểm cho chủ đề #9 thì gõ /luandiem XYZ." **Khi** điền văn bản rồi Xác nhận, **thì** kho có một chủ đề mới (ID mới, không phải #9) với bí danh đang dùng "ABC" và luận điểm bản 1; người dùng thấy "Đã lưu luận điểm ABC bản 1."; chủ đề #9 không đổi (vẫn bí danh "XYZ", "ABC" vẫn ở lịch sử bí danh của #9, chưa có luận điểm). **Cho** ô bí danh khác của form chủ đề mới có "HPG" (bí danh đang dùng của chủ đề HPG), **khi** Xác nhận, **thì** không lưu gì, báo "Bí danh «HPG» đang thuộc chủ đề HPG." (spec 001 Story 3 kịch bản 4).

### Story 4: `/quyetdinh` ghi đúng căn cứ người dùng đã xem (P1)

Người dùng gõ `/quyetdinh HPG` sau khi xem luận điểm HPG bản 3, ghi "Mua HPG", lý do "Biên gộp hồi phục". Họ muốn quyết định luôn nhớ đúng bản luận điểm đã hiện trên form, kể cả khi luận điểm vừa được sửa ở cửa sổ khác (T5, C10 B6, C9 tình huống B).

- **Vì sao ưu tiên này:** quyết định gắn sai căn cứ là sai âm thầm và không sửa được (quyết định ghi nối).
- **Kiểm độc lập:** kho ví dụ, mở form, đổi kho ở "cửa sổ khác" (kết nối thứ hai trong test) trước khi xác nhận.

**Kịch bản nghiệm thu:**

1. **Cho** kho ví dụ, **khi** gõ `/quyetdinh HPG`, **thì** form hiện ô việc, lý do, các ô tuỳ chọn (kỳ vọng, mức tự tin, ngày xem lại, điều gì làm đổi ý), và phần căn cứ hiện nguyên văn luận điểm HPG bản 3 (văn bản, điều kiện), có lựa chọn "Không gắn luận điểm". Đầu form ghi: "Nhật ký quyết định chỉ nằm trên máy này; không bao giờ được gửi cho model. Đây không phải lệnh giao dịch."
2. **Cho** form trên, **khi** ghi việc "Mua HPG", lý do "Biên gộp hồi phục" rồi Xác nhận, **thì** kho có quyết định D1 căn cứ "HPG bản 3", bộ ràng buộc bản 5; người dùng thấy "Đã ghi quyết định D1 (căn cứ: luận điểm HPG bản 3)."; không request nào gửi model chứa "Mua HPG" ở lượt sau.
3. **Cho** form đang hiện HPG bản 3, cửa sổ khác lưu bản 4 trước khi xác nhận, **khi** Xác nhận, **thì** form không lưu ngay mà hỏi: "Luận điểm HPG vừa có bản 4 (bạn đang xem bản 3). Gắn quyết định với: [Bản 3, bản bạn đã xem] [Xem bản 4 trước] [Huỷ]". Chọn "Bản 3" thì D1 gắn bản 3; chọn "Xem bản 4" thì form hiện bản 4, người dùng xác nhận lại mới lưu, gắn bản 4. Không bao giờ tự gắn bản 4 khi người dùng chưa thấy bản 4.
4. **Cho** form đang hiện HPG bản 3, cửa sổ khác xoá luận điểm HPG, **khi** Xác nhận, **thì** không lưu; báo "Luận điểm HPG bản 3 vừa bị xoá. Ghi quyết định không gắn luận điểm, hoặc huỷ."; nội dung đã gõ trong form giữ nguyên.
5. **Cho** VCB có trong kho nhưng chưa có luận điểm, **khi** gõ `/quyetdinh VCB`, **thì** phần căn cứ ghi "VCB chưa có luận điểm"; lưu được với căn cứ "không có luận điểm".
6. **Cho** kho chưa có chủ đề MWG, **khi** gõ `/quyetdinh MWG`, **thì** form ghi "MWG chưa có trong sổ; lưu sẽ tạo chủ đề MWG (loại mã)." và lưu được; chủ đề MWG được tạo không có luận điểm.
7. **Cho** quyết định D1 đã lưu, **khi** mở D1 trong `/memory`, **thì** không có thao tác sửa; chỉ có xoá (quyết định ghi nối, spec 001 YC-018).

### Story 5: `/baihoc` và cảnh báo lệch ngăn (P1)

Người dùng ghi bài học "Định giá ngân hàng: dùng P/B, không dùng P/E". Người dùng cũng có thể ghi nhầm một luật cứng như "Không bao giờ bắt đáy" thành bài học; khi đó luật không còn luôn có mặt và không ai được báo (K7).

- **Vì sao ưu tiên này:** K7: hướng nhầm nguy hiểm nhất là ràng buộc bị lưu thành bài học (ADR 0005 mục 6).
- **Kiểm độc lập:** mở form, gõ các câu mẫu, đọc cảnh báo và kho.

**Kịch bản nghiệm thu:**

1. **Cho** kho ví dụ, **khi** gõ `/baihoc` rồi điền tiêu đề "Quản trị rủi ro khi giải ngân", tóm tắt "Giải ngân từng phần, không dồn một lần", áp dụng cho (trống), ngoại lệ (trống), tag "rủi ro" rồi Xác nhận, **thì** kho có bài học #8 bản 1; người dùng thấy "Đã lưu bài học #8 (bản 1)."
2. **Cho** form bài học, **khi** tiêu đề là "Không bao giờ bắt đáy", **thì** form hiện cảnh báo trước khi lưu: "Câu này có dạng một luật cứng («không bao giờ»). Bài học chỉ được model đọc khi cần, không luôn được áp dụng. Muốn luôn áp dụng thì lưu thành ràng buộc." kèm hai nút [Lưu thành ràng buộc] [Vẫn lưu bài học]. Chọn "Lưu thành ràng buộc" thì mở form `/nho` điền sẵn câu đó, đã chọn ngăn "Ràng buộc".
3. **Cho** form bài học, **khi** tóm tắt có một trong các dạng "tuyệt đối không", "cấm", "không được", "tối đa 15% danh mục", **thì** có cùng cảnh báo. **Cho** tóm tắt "Dùng P/B và ROE, không dùng P/E", **thì** không có cảnh báo.
4. **Cho** gõ `/baihoc` rồi điền áp dụng cho "Ngân hàng, Chứng khoán" khi kho chưa có chủ đề "Chứng khoán", **khi** Xác nhận, **thì** form hỏi "Chưa có chủ đề «Chứng khoán». Tạo chủ đề ngành «Chứng khoán»?"; đồng ý thì tạo chủ đề ngành rồi lưu bài học áp dụng cho hai chủ đề đó.
5. **Cho** bài học có tiêu đề 121 ký tự, **khi** gõ, **thì** form hiện "121/120" và không cho Xác nhận.
6. **Cho** bài học #7 "Định giá ngân hàng" đã có, **khi** lưu bài học mới có cùng tiêu đề sau chuẩn hoá, **thì** form cảnh báo "Trùng tiêu đề bài học #7. Sửa #7 trong /memory thay vì tạo mới?" và vẫn cho lưu nếu người dùng chọn.

### Story 6: Hai cửa sổ cùng sửa một mục (P1)

Người dùng mở `/luandiem HPG` ở cửa sổ A, rồi sửa HPG ở cửa sổ B và lưu. Quay lại A, họ muốn không mất bản của B và thấy B đã đổi gì (C4 bước 5, C8, C9 tình huống E).

- **Vì sao ưu tiên này:** ghi đè âm thầm là mất dữ liệu; kho đã từ chối (spec 001 YC-011), nhưng người dùng cần thấy chỗ khác nhau để quyết định.
- **Kiểm độc lập:** hai kết nối vào cùng kho trong test, mở form ở kết nối A, lưu ở B, xác nhận ở A.

**Kịch bản nghiệm thu:**

1. **Cho** A đang sửa HPG từ bản 3 (đã đổi điều kiện (2) thành "… quá 25%"), B đã lưu bản 4 (đổi văn bản thành "Hưởng lợi từ đầu tư công và giá thép phục hồi"), **khi** A Xác nhận, **thì** không ghi gì; A thấy "Mục này vừa được sửa ở nơi khác (đang là bản 4)." và chỗ khác nhau theo từng ô:
   ```
   Văn bản     bản 4: Hưởng lợi từ đầu tư công và giá thép phục hồi
               của bạn: Hưởng lợi từ đầu tư công
   Điều kiện 2 bản 4: Sai nếu tồn kho tăng quá 30%
               của bạn: Sai nếu tồn kho tăng quá 25%
   ```
   kèm ba lựa chọn: [Lưu bản của tôi thành bản 5] [Bỏ bản của tôi, xem bản 4] [Sửa tiếp]. Nội dung A đã gõ không mất.
2. **Cho** màn hình xung đột trên, **khi** chọn "Lưu bản của tôi thành bản 5", **thì** form hiện lại chỗ khác nhau so với bản 4 và cần Xác nhận lần nữa; xác nhận thì kho có bản 5 đúng nội dung của A, bản 4 vẫn đọc được.
3. **Cho** A đang sửa ràng buộc #1 từ bản 2, B xoá #1, **khi** A Xác nhận, **thì** không ghi gì; báo "Mục này đã bị xoá ở nơi khác." kèm lựa chọn [Lưu thành ràng buộc mới] [Huỷ].
4. **Cho** B đang giữ quyền ghi lâu hơn thời gian chờ của kho, **khi** A Xác nhận, **thì** trong dưới 2 giây A thấy "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại."; form và nội dung giữ nguyên; kho không đổi.
5. **Cho** A đang sửa bài học #7 từ bản 1, không ai đổi gì, **khi** Xác nhận, **thì** lưu bản 2 bình thường (không có màn hình xung đột).

### Story 7: `/memory` sửa, đổi trạng thái, xuất Markdown (P2)

Người dùng mở `/memory`, chọn một mục để sửa, đổi trạng thái luận điểm sang "đã bị bác bỏ", hoặc xuất cả sổ ra một file Markdown để đọc ngoài app.

- **Vì sao ưu tiên này:** sửa tay file kho không còn là đường ghi (C9 tình huống E); người dùng cần sửa trong app và có bản đọc được ngoài app. Thấp hơn P1 vì các lệnh ở Story 1–5 đã tạo và sửa được qua lệnh.
- **Kiểm độc lập:** test giao diện headless với kho ví dụ.

**Kịch bản nghiệm thu:**

1. **Cho** đang xem luận điểm HPG bản 3 trong `/memory`, **khi** bấm phím sửa, **thì** mở form của `/luandiem HPG` điền sẵn bản 3, giống hệt Story 3 kịch bản 1. Tương tự: ràng buộc, cách trình bày mở form `/nho` đã chọn sẵn ngăn và điền sẵn bản hiện hành; bài học mở form `/baihoc`.
2. **Cho** đang xem luận điểm HPG bản 3, **khi** chọn đổi trạng thái → "đã bị bác bỏ" và xác nhận, **thì** trạng thái đổi, không tạo bản mới; danh sách hiện "HPG · bản 3 · đã bị bác bỏ"; lượt hỏi kế tiếp có dòng nhắc trạng thái nếu khối HPG đã gửi trong phiên (spec 002 Story 4 kịch bản 3).
3. **Cho** đang xem quyết định D1, **khi** tìm thao tác sửa, **thì** không có (Story 4 kịch bản 7).
4. **Cho** kho ví dụ có thêm quyết định D1 "Mua HPG", **khi** chọn xuất Markdown và giữ mặc định, **thì** một file `.md` được ghi trong thư mục xuất của app (ví dụ `…/exports/so-ghi-nho-03-11-2026.md`), người dùng thấy đường dẫn; file có bốn nhóm Ràng buộc, Cách trình bày, Luận điểm, Bài học, mỗi mục kèm ID hoặc mã, số bản, ngày lưu tuyệt đối, nguồn; luận điểm có đủ điều kiện "Sai nếu"; mục đã xoá không có; **không có "Mua HPG"** hay nhóm Quyết định.
5. **Cho** màn xuất, **khi** bật "kèm nhật ký quyết định", **thì** màn xuất cảnh báo "File sẽ có nhật ký quyết định. Model đọc được file này nếu bạn đưa nó vào thư mục làm việc." rồi mới xuất; file có thêm nhóm Quyết định với D1, căn cứ "luận điểm HPG bản 3". Lần xuất sau lựa chọn này lại về tắt.
6. **Cho** file xuất đã có, **khi** xoá bài học #7 trong `/memory`, **thì** câu báo xoá không hứa xoá cả file đã xuất; màn xuất đã nói trước "File xuất là bản sao; xoá trong sổ không xoá file này."

### Story 8: Gõ lệnh memory khi sổ ghi nhớ không dùng được (P1)

Người dùng gõ `/nho Không dùng margin` khi `/config` đang "Tắt" hoặc "Memory cũ", hoặc khi sổ ghi nhớ đang bật nhưng kho không mở được.

- **Vì sao ưu tiên này:** người dùng tưởng đã lưu ràng buộc mà thật ra chưa là sai âm thầm, đúng loại lỗi phải tránh nhất.
- **Kiểm độc lập:** đặt từng lựa chọn trong `/config`, gõ lệnh, đọc câu báo, kho và lịch sử ô nhập.

**Kịch bản nghiệm thu:**

1. **Cho** `/config` đang "Tắt", **khi** gõ `/nho Không dùng margin`, **thì** không mở form, không mở kho; người dùng thấy "Sổ ghi nhớ đang tắt; /nho chưa lưu gì. Bật trong /config (mục Memory → Sổ ghi nhớ) rồi gõ lại."; chữ đã gõ giữ nguyên trong ô nhập (như khi gõ sai tên lệnh) để không mất; lịch sử ô nhập chỉ có "/nho" (người dùng chốt 03/11/2026).
2. **Cho** `/config` đang "Memory cũ", **khi** gõ `/nho …`, **thì** như kịch bản 1, câu báo thêm: "Lệnh này ghi vào sổ ghi nhớ, không ghi vào memory cũ."; dữ liệu memory cũ không đổi; cấu hình không đổi.
3. **Cho** ô nhập còn `/nho Không dùng margin` sau kịch bản 1, **khi** bấm Esc hai lần để xoá, **thì** lịch sử ô nhập vẫn chỉ có "/nho" (Story 2).
4. **Cho** sổ ghi nhớ đang bật nhưng kho mở lỗi (lược đồ mới hơn bản app), **khi** gõ `/luandiem HPG`, **thì** không mở form; báo lý do và đường dẫn như spec 002 Story 7 kịch bản 4; file kho giữ nguyên.
5. **Cho** form đang mở mà kho đã bị đóng (ví dụ người dùng thoát app, hoặc đổi `/config` làm form đóng theo), **khi** có lần Xác nhận tới sau đó, **thì** báo "Sổ ghi nhớ đã tắt; chưa lưu."; không ghi vào kho đã đóng.

## 3. Tình huống biên và lỗi

- **Kho bận:** lần lưu chờ tối đa thời gian chờ quyền ghi của kho (dưới 2 giây), rồi báo bận; form và nội dung giữ nguyên để thử lại (Story 6 kịch bản 4). Không có thao tác ghi nào trên đường dựng request hay đường vẽ màn hình; chỉ khi người dùng bấm Xác nhận.
- **Đọc kho lỗi khi mở form** (file hỏng giữa chừng, lỗi đĩa): form không mở với ô trống như thể "chưa có gì"; báo lỗi. Một form điền sẵn trống vì đọc lỗi sẽ dẫn tới ghi đè bằng bản rỗng.
- **Lưu lỗi vì kiểm đầu vào của kho** (vượt giới hạn, khoá bí mật, trường bắt buộc trống, bí danh đã có chủ): form giữ nguyên nội dung, nêu trường và lý do; câu báo không chép chữ người dùng gõ.
- **Form kiểm giới hạn trước, kho vẫn kiểm lại:** form đếm ký tự như kho (theo ký tự người đọc thấy, sau chuẩn hoá); nếu hai bên lệch thì kho thắng và form báo lỗi của kho.
- **Tạo chủ đề rồi lưu nội dung lỗi** (ví dụ chủ đề FPT tạo được, luận điểm bị từ chối vì quá dài): không để người dùng tưởng đã lưu luận điểm; câu báo nói rõ chủ đề đã tạo, luận điểm chưa lưu. Chủ đề rỗng không chứa nội dung riêng tư ngoài bí danh, nên chấp nhận để lại.
- **Văn bản có xuống dòng, `</memory>`, nhãn giả "[Memory · ràng buộc · …]", emoji, chữ có dấu tổ hợp:** lưu đúng từng ký tự; escape khi đưa vào prompt đã do spec 002 làm (spec 002 TC-009 vẫn xanh với mục do form tạo).
- **Mã gõ chữ thường hoặc có dấu cách thừa** (`/luandiem  hpg `): tìm chủ đề không phân biệt hoa thường; chủ đề mới loại "mã" lưu bí danh viết hoa ("HPG").
- **Mã gõ sai** ("hgp"): form coi là chủ đề mới "HGP"; không đoán sửa (mã gõ sai thuộc bảng "Để sau"). Đầu form ghi rõ "Chủ đề mới", nên người dùng thấy trước khi lưu.
- **Lệnh gõ khi đang có câu trả lời chạy:** form vẫn mở và lưu được; thay đổi có hiệu lực chậm nhất từ lượt hỏi kế tiếp.
- **Đóng form bằng Esc hoặc Ctrl+C khi đã gõ:** hỏi lại "Bỏ nội dung đang sửa?"; bỏ thì nội dung không được lưu ở đâu cả (không vào lịch sử ô nhập). Form chưa có thay đổi thì Esc hay Ctrl+C đều đóng ngay. Bấm Ctrl+C lần hai liền sau đó vẫn thoát app như mọi chỗ khác (người dùng chốt 04/11/2026).
- **Enter:** chỉ lưu khi form đang được chọn và đang ở nút Xác nhận; Enter trong ô nhiều dòng xuống dòng hoặc chuyển ô, không lưu; Enter ở ô nhập chat không bao giờ xác nhận form (C4 bước 3).
- **Hai lệnh memory liên tiếp** (`/nho` khi form `/baihoc` đang mở): form đang mở giữ nguyên; lệnh mới chỉ chạy sau khi đóng form.
- **Windows:** đóng app khi form đang mở thì không có gì được lưu nửa vời; kho được đóng như spec 002 (xoá được file kho ngay sau đó).
- **Xuất Markdown:** ghi file lỗi (thư mục không ghi được, đĩa đầy) thì báo lỗi, không báo "đã xuất"; file có sẵn cùng tên thì không ghi đè (thêm hậu tố thời gian).

## 4. Yêu cầu

### Yêu cầu chức năng

| Mã | Yêu cầu | Nguồn |
| --- | --- | --- |
| YC-001 | Hệ thống PHẢI có bốn lệnh `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh`; tên lệnh không trùng lệnh có sẵn, lệnh playbook hay lệnh MCP; gõ hoa hay thường đều nhận | C4 bước 1; design v5 §6; `specs/README.md` dòng 003 |
| YC-002 | Lệnh memory PHẢI chạy hoàn toàn tại máy: 0 request mạng, chạy được khi chưa kết nối provider nào, không tạo lượt hội thoại, không ghi gì vào file phiên | C10 B5; design v5 §6 |
| YC-003 | Lịch sử ô nhập PHẢI chỉ lưu tên lệnh (ví dụ "/nho") cho lệnh memory, không lưu tham số hay đoạn dán, ở cả đường gửi lẫn đường xoá ô (Esc hai lần, Ctrl+C). Lệnh khác và câu chat giữ nguyên hành vi hiện nay | T6, §B7, C4 bước 1, C10 B5 |
| YC-004 | Nội dung người dùng gõ trong form PHẢI không đi qua ô nhập chat, không vào lịch sử ô nhập, không vào file phiên, không vào request | §B7 (T6); C10 B5 |
| YC-005 | Chỉ form của các lệnh memory và màn `/memory` PHẢI giữ được quyền ghi vào kho, qua tay cầm quản trị của sổ ghi nhớ (object-capability, spec 002); provider và mọi thứ đưa cho model không có tham chiếu tới thao tác ghi; một test quét mã kiểm chỉ các màn đó dùng tay cầm | Bất biến 7; C10 B4; spec 001 YC-023; spec 002 YC-029 |
| YC-006 | Model PHẢI không có đường ghi nào: không thêm tool; chữ trong câu trả lời của model, kết quả tool hay thông báo agent con không bao giờ kích hoạt lệnh memory hay mở form | Bất biến 7; C10 B4; Q6 (chỉ vai người dùng "làm cho có hiệu lực") |
| YC-007 | Mỗi lần lưu PHẢI cần một thao tác Xác nhận rõ ràng của người dùng trên form đang được chọn; Enter ở ô nhập chat hay trong ô nhiều dòng không lưu | C4 bước 3; design v5 §6 |
| YC-008 | `/nho [văn bản]` PHẢI mở form có ô văn bản (điền sẵn phần sau tên lệnh), lựa chọn ngăn Ràng buộc hoặc Cách trình bày **không có mặc định**, tiêu chí phân loại của từng ngăn, danh sách ràng buộc đang có kèm tổng ký tự trên giới hạn | ADR 0005 mục 1, 6; design v5 §6 ("không mặc định nâng mọi lời nói thành luật cứng"); K7 lớp 1 |
| YC-009 | `/luandiem <mã>` PHẢI mở form điền sẵn bản hiện hành (văn bản, chi tiết, điều kiện "Sai nếu" có thứ tự, hạn xem lại) và ghi rõ "đang sửa từ bản N"; chủ đề chưa có thì form có thêm ô loại, ngành, bí danh khác, cờ "chỉ khớp khi viết hoa", và lưu tạo chủ đề cùng luận điểm | C3, C4 bước 2; Q7; spec 001 YC-014–YC-016 |
| YC-010 | `/baihoc` PHẢI mở form có tiêu đề, tóm tắt, áp dụng cho (tên chủ đề mã hoặc ngành), ngoại lệ, chi tiết, tag; tên chủ đề chưa có thì hỏi tạo chủ đề trước khi lưu | C3; spec 001 YC-017 |
| YC-011 | `/quyetdinh <mã>` PHẢI mở form có việc, lý do, các ô tuỳ chọn, và phần căn cứ hiện nguyên văn bản luận điểm hiện hành (hoặc "chưa có luận điểm"), có lựa chọn không gắn luận điểm; form ghi rõ quyết định chỉ nằm trên máy và không phải lệnh giao dịch | C3, C4 bước 4; spec 001 YC-018; bất biến chỉ đọc |
| YC-012 | Quyết định PHẢI gắn đúng bản luận điểm **form đã hiển thị**; nếu lúc lưu bản hiện hành đã khác, form PHẢI hỏi người dùng gắn bản đã xem hay xem bản mới trước, không bao giờ tự gắn bản người dùng chưa thấy; bản đã xem bị xoá thì không lưu và cho chọn không gắn luận điểm. Phiên bản bộ ràng buộc là bản tại lúc ghi, do kho đọc trong cùng lần ghi | C4 bước 4; C9 tình huống B; C10 B6; spec 001 YC-019 và Story 5 kịch bản 2 |
| YC-013 | Mọi lần sửa PHẢI gửi kèm số bản form đã đọc lúc mở; trước khi Xác nhận một lần sửa, form PHẢI hiện chỗ khác nhau theo từng ô so với bản đó | C4 bước 2–3; ADR 0003 (chống ghi đè) |
| YC-014 | Khi kho từ chối vì xung đột phiên bản, form PHẢI không ghi gì, giữ nội dung người dùng, hiện chỗ khác nhau theo từng ô giữa bản hiện có và bản của người dùng, và cho chọn: lưu bản của mình thành bản mới (cần Xác nhận lại), bỏ bản của mình để xem bản hiện có, hoặc sửa tiếp. Mục đã bị xoá ở nơi khác thì báo rõ và cho chọn lưu thành mục mới | C4 bước 5; C8 "Hai cửa sổ cùng sửa"; T5 |
| YC-015 | Form PHẢI hiện số ký tự trên giới hạn cho từng trường có giới hạn (theo bảng giới hạn của spec 001), không cho Xác nhận khi vượt, không bao giờ tự cắt; với ràng buộc và cách trình bày hiện cả tổng đang có hiệu lực | C2 cột "Giới hạn"; spec 001 YC-024; H4 |
| YC-016 | Form PHẢI hiện đúng lỗi kho trả (vượt giới hạn, khoá bí mật, trường trống, bí danh đã có chủ, kho bận, đã xoá) mà không chép chữ người dùng gõ vào câu báo, và giữ nguyên nội dung form | Spec 001 YC-024, YC-031; bất biến bí mật |
| YC-017 | Form bài học PHẢI cảnh báo, không chặn, khi tiêu đề hoặc tóm tắt có dạng cấm đoán hoặc giới hạn cứng ("không bao giờ", "tuyệt đối không", "cấm", "không được", "tối đa … % danh mục"), kèm lựa chọn chuyển sang form ràng buộc đã điền sẵn | K7 lớp 2, §B7; ADR 0005 mục 6 |
| YC-018 | Form PHẢI cảnh báo, không chặn, khi văn bản mới trùng (sau khi bỏ khác biệt hoa thường, khoảng trắng, dạng Unicode) một ràng buộc, cách trình bày đang có, hoặc tiêu đề một bài học đang có, kể cả trùng giữa ràng buộc và bài học | K7 lớp 3 (phần trùng), ADR 0005 mục 6 |
| YC-019 | Form PHẢI có dòng hướng dẫn cố định: "Không ghi giá, số liệu hiện hành hay dự báo; model lấy số mới bằng tool. Ngưỡng của bạn (tối đa 20%, Sai nếu biên gộp dưới 10%) thì được." Thêm vào đó, form PHẢI **cảnh báo, không chặn** khi một trường văn bản có dạng giá tiền (số kèm đơn vị tiền như "đồng", "nghìn", "k", "tỷ", hoặc cụm "giá mục tiêu", "giá hiện tại") hoặc dạng dự báo ("dự báo", "sẽ lên", "sẽ xuống", "sẽ đạt"); không cảnh báo chỉ vì có số hay phần trăm. Người dùng vẫn lưu được sau khi thấy cảnh báo (người dùng chốt 03/11/2026) | Bất biến 6; H3; design v5 §6 ("dùng cảnh báo … theo loại"); spec 001 §6 (kho không chặn số) |
| YC-020 | Lưu thành công PHẢI báo "Đã lưu …" kèm loại, ID hoặc mã, số bản, và lúc có hiệu lực ("từ lượt hỏi kế tiếp"); câu báo không chép nội dung. Lưu không thành công thì không câu nào nói hay ngụ ý đã lưu | C4 bước 5; quy ước "thiếu dữ liệu phải hiện ra" |
| YC-021 | Form ràng buộc PHẢI nói rõ giới hạn hiện có: ràng buộc chỉ gửi cho agent chính khi sổ ghi nhớ đang bật, chưa gửi cho agent con | Spec 002 §8 giới hạn 3; quy tắc trung thực về trạng thái |
| YC-022 | Lưu bản mới của luận điểm đang "đã bị bác bỏ" hoặc "đã đóng" PHẢI báo trước khi Xác nhận rằng trạng thái sẽ về "đang theo dõi" | Hành vi kho spec 001 (bản mới đặt trạng thái "đang theo dõi") |
| YC-023 | `/memory` PHẢI có thao tác sửa cho ràng buộc, cách trình bày, luận điểm, bài học, mở đúng form của lệnh tương ứng điền sẵn bản hiện hành; quyết định không có thao tác sửa | C4; spec 001 YC-018; design v5 §6 |
| YC-024 | `/memory` PHẢI có thao tác đổi trạng thái luận điểm (đang theo dõi, đã bị bác bỏ, đã đóng), hỏi lại trước khi đổi, gửi kèm số bản đang xem, không tạo bản mới | C3 "Chủ đề"; spec 001 YC-014, YC-011 |
| YC-025 | `/memory` PHẢI xuất được sổ ra một file Markdown trong thư mục xuất của app (cùng thư mục mặc định của lệnh `/export`, nằm trong thư mục dữ liệu, không bao giờ là workspace): bản hiện hành của mỗi mục còn hiệu lực, theo nhóm, mỗi mục có ID hoặc mã, số bản, ngày tuyệt đối, nguồn; không có mục đã xoá; ghi lỗi thì báo lỗi; không ghi đè file có sẵn. **Mặc định không có nhật ký quyết định**; người dùng phải bật "kèm nhật ký quyết định" ở **từng lần** xuất (không nhớ lựa chọn), và màn xuất khi đó cảnh báo file có quyết định, model đọc được nếu file bị đưa vào workspace (người dùng chốt 03/11/2026) | C9 tình huống E ("có xuất Markdown"); design v5 §4.2, §6, §7; ADR 0006 mục 5 (xuất là một đường đọc); C10 B3 |
| YC-026 | Lệnh memory khi sổ ghi nhớ không dùng được PHẢI không mở form, không mở kho, không ghi vào memory cũ, không đổi cấu hình, không báo đã lưu; nói rõ lý do và cách bật; giữ chữ đã gõ trong ô nhập. Bốn ca: "Tắt"; "Memory cũ" (nói thêm lệnh ghi vào sổ ghi nhớ, không ghi vào memory cũ); kho mở lỗi (lý do và đường dẫn); kho đã đóng khi form còn mở (người dùng chốt 03/11/2026) | Spec 002 YC-026; C8; quy tắc `FileMemory` giữ nguyên |
| YC-027 | Đọc kho lỗi khi mở form PHẢI báo lỗi, không mở form trống thay cho bản hiện hành | Quy ước "không bắt lỗi chung chung rồi trả rỗng"; C8 |
| YC-028 | Không thao tác ghi nào chạy trên đường dựng request hay đường vẽ màn hình; ghi chỉ xảy ra khi người dùng bấm Xác nhận hay xác nhận một câu hỏi lại | Spec 001 §3 "Kho bận"; ghi chú duyệt của spec 001 về giao diện bị chặn tới 1 giây |
| YC-029 | Mọi mục tạo hay sửa qua form PHẢI có nguồn "gõ tay"; ngày lưu là thời điểm tuyệt đối do kho ghi | Spec 001 YC-012, YC-030 |
| YC-030 | Test duyệt bảng chính sách PHẢI có thêm đường "xuất Markdown" ở vai người dùng, và vẫn khẳng định không vai nào của model làm cho mục có hiệu lực | ADR 0006 mục 5; C10 B3, B4 |

### Thực thể chính

Không có thực thể mới trong kho. Spec này dùng các thực thể của spec 001 (ràng buộc, chủ đề, bí danh, bản luận điểm, bài học, quyết định, phiên bản bộ ràng buộc) và thêm thứ chỉ sống trong giao diện:

- **Bản nháp của form:** nội dung người dùng đang gõ, kèm số bản đã đọc lúc mở form (mốc chống ghi đè) và, với quyết định, số bản luận điểm đã hiển thị. Chỉ ở RAM, mất khi đóng form; không ghi xuống đĩa.
- **Chỗ khác nhau theo từng ô:** so hai bản (bản đã đọc hoặc bản hiện có, với bản của người dùng), từng ô một (văn bản, từng điều kiện, hạn xem lại, chi tiết, tóm tắt…), chỉ hiện ô khác nhau.
- **File xuất Markdown:** bản sao chỉ đọc của sổ tại một thời điểm; không phải đường ghi, không đọc lại vào kho.

## 5. Tiêu chí thành công

| Mã | Tiêu chí đo được | Kiểm bằng |
| --- | --- | --- |
| TC-001 | Story 1 kịch bản 1–9: form `/nho` không có ngăn mặc định; lưu đúng loại, số bản, nguồn; phiên bản bộ ràng buộc tăng với ràng buộc, không tăng với cách trình bày; lượt kế tiếp có dòng mới trong phần hệ thống; vượt tổng không cho lưu; khoá giả bị chặn và không xuất hiện ở đâu | `bun test` (giao diện headless, model giả) |
| TC-002 | Với mỗi lệnh trong bốn lệnh, đi trọn từ gõ lệnh tới lưu: `fetch` giả đếm 0 request; chạy được khi chưa kết nối provider | `bun test` |
| TC-003 | Story 2 kịch bản 1–5: sau mỗi đường (gửi, Esc hai lần, Ctrl+C, đoạn dán, chữ hoa), file lịch sử ô nhập trong thư mục tạm chỉ có tên lệnh; câu chat thường vẫn được lưu nguyên | `bun test` |
| TC-004 | Story 2 kịch bản 6–7: chữ "/nho …" trong câu trả lời của model không mở form, kho không đổi; file phiên không chứa chuỗi đánh dấu đã gõ trong form hay tham số lệnh | `bun test` |
| TC-005 | Test quét mã: chỉ các màn form memory và `/memory` dùng tay cầm quản trị (ngoài thư mục sổ ghi nhớ); danh sách tool của agent chính vẫn chỉ có `memory_read` là tool memory | `bun test` |
| TC-006 | Story 3 kịch bản 1–7 và 9: form điền đúng bản; lưu tạo bản mới, bản cũ đọc lại được; chủ đề mới tạo cùng luận điểm bản 1; viết lại sau xoá là bản 4; giới hạn 8 điều kiện; cảnh báo trạng thái về "đang theo dõi"; `/luandiem ABC` (bí danh đã thôi dùng của #9) tạo chủ đề mới có ID khác #9, luận điểm bản 1, câu báo nêu #9, chủ đề #9 không đổi; bí danh đang thuộc chủ đề khác bị từ chối, kho không đổi | `bun test` |
| TC-007 | Story 4 kịch bản 1–7: quyết định gắn đúng bản đã hiển thị; bản mới hơn ở cửa sổ khác thì có câu hỏi và không tự gắn bản mới; bản bị xoá thì không lưu; chủ đề chưa có luận điểm lưu "không có luận điểm"; chủ đề chưa có được tạo; chuỗi đánh dấu trong lý do không có trong request nào của lượt sau | `bun test` (hai kết nối vào cùng kho) |
| TC-008 | Story 5 kịch bản 1–6: cảnh báo lệch ngăn có với từng câu mẫu dạng cấm đoán, không có với "Dùng P/B và ROE, không dùng P/E"; "Lưu thành ràng buộc" mở form `/nho` đã chọn ngăn; trùng tiêu đề có cảnh báo | `bun test` |
| TC-009 | Story 6 kịch bản 1–5: xung đột không ghi gì, hiện đúng các ô khác nhau, giữ nội dung; "lưu thành bản mới" cần xác nhận lại và tạo đúng bản; mục bị xoá ở nơi khác báo đúng; kho bận báo trong dưới 2 giây, kho không đổi | `bun test` (hai kết nối, một tiến trình phụ giữ quyền ghi) |
| TC-010 | Story 7 kịch bản 1–6: sửa từ `/memory` mở đúng form điền sẵn; đổi trạng thái không tạo bản mới; quyết định không có thao tác sửa; file xuất nằm trong thư mục xuất của app, có đủ mục còn hiệu lực, không có mục đã xoá, không ghi đè file có sẵn; xuất mặc định không chứa chuỗi đánh dấu đặt trong lý do quyết định; bật "kèm nhật ký quyết định" thì có, và lần xuất sau lại về mặc định | `bun test` |
| TC-011 | Story 8 kịch bản 1–5: ở "Tắt", "Memory cũ", kho lỗi, kho đã đóng: không câu nào nói đã lưu khi kho không có mục; dữ liệu memory cũ không đổi; lịch sử ô nhập chỉ có tên lệnh | `bun test` |
| TC-012 | Mỗi lỗi kho (vượt giới hạn, khoá bí mật, trường trống, bí danh đã có chủ, bận, đã xoá) hiện đúng câu báo trên form, form giữ nội dung, câu báo không chứa chữ người dùng gõ | `bun test` |
| TC-013 | Test duyệt bảng chính sách có đường xuất Markdown ở vai người dùng; mọi tổ hợp vai × hành động × bối cảnh vẫn khớp bảng kỳ vọng | `bun test` |
| TC-014 | Không test nào chạm mạng hay thư mục dữ liệu thật; mọi kho được đóng trước khi xoá thư mục tạm; typecheck sạch; toàn bộ `bun test` xanh ở máy và trên CI Windows, Ubuntu | `bun run typecheck`, `bun test`, CI |
| TC-015 | Người dùng kiểm tay một lần trên TUI thật (mốc "dùng được" sau spec 003): `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh`, sửa, xoá, xuất; hỏi một câu về HPG thấy khối luận điểm mới | Thao tác trên giao diện |
| TC-016 | Story 3 kịch bản 8: cảnh báo số liệu có với từng câu mẫu dạng giá tiền hoặc dự báo, không có với "Sai nếu biên gộp dưới 10% hai quý liền" và "Tối đa 20% danh mục cho một mã"; sau cảnh báo vẫn lưu được | `bun test` |

## 6. Đối chiếu bất biến

| Bất biến | Spec giữ thế nào |
| --- | --- |
| Chỉ đọc (không đặt lệnh) | Không thêm tool. `/quyetdinh` là nhật ký tại máy; form ghi rõ "không phải lệnh giao dịch" (YC-011) |
| Quyền do code quyết định | Quyền ghi là tay cầm quản trị chỉ form và `/memory` giữ (YC-005); chữ của model, tool, agent con không kích hoạt lệnh (YC-006); bảng chính sách không đổi phần "chỉ người dùng làm cho có hiệu lực" (YC-030) |
| Output bên ngoài là dữ liệu không tin cậy | Lệnh chỉ chạy từ chữ người dùng gõ vào ô nhập (YC-006). Nội dung do form tạo vẫn được spec 002 escape khi đưa vào prompt (§3) |
| Bí mật | Kho chặn mẫu khoá (spec 001); form hiện lỗi không chép chữ (YC-016); lịch sử ô nhập không giữ tham số hay đoạn dán của lệnh memory (YC-003), nên khoá dán nhầm không nằm lại trên đĩa (T6) |
| Test không chạm mạng và `~/.opentrading` thật | Thư mục dữ liệu tạm, `fetch` giả đếm request (TC-002, TC-014) |
| Không bịa số; memory không lưu giá, số liệu, dự báo | Form có dòng hướng dẫn (YC-019); không chặn số bằng mẫu ở kho (H3); khối khi đọc vẫn có nhãn "người dùng tự ghi" và ngày tuyệt đối (spec 002). Form cảnh báo, không chặn, khi văn bản có dạng giá tiền hoặc dự báo (YC-019, TC-016) |
| Chỉ hành động tin cậy của người dùng làm memory có hiệu lực; model không có tool ghi | Mỗi lần lưu cần Xác nhận trên form (YC-007); không đường nào qua model (YC-006); không thêm tool (TC-005) |
| Lịch sử phiên append-only; xoá là che | Lệnh memory không ghi gì vào file phiên (YC-002). Sửa tạo bản mới; dòng nhắc "đã có bản mới" ở lượt sau do spec 002 làm. Xoá vẫn theo câu báo của spec 002; file xuất là bản sao và câu báo nói rõ xoá trong sổ không xoá file xuất (Story 7 kịch bản 5) |
| Quyết định không tự vào context | Quyết định chỉ ghi vào kho; không đường đọc nào cho model đổi (spec 002 YC-020); TC-007 kiểm chuỗi đánh dấu trong lý do không có trong request. File xuất mặc định không có quyết định, nằm ngoài workspace; muốn kèm phải bật từng lần, có cảnh báo (YC-025, TC-010) |
| Ràng buộc không bao giờ bị cắt | Form không cho lưu khi vượt giới hạn, không cắt (YC-015) |
| Đọc lỗi phải hiện ra | Đọc lỗi khi mở form thì báo, không mở form trống (YC-027); lưu lỗi không báo đã lưu (YC-020) |

## 7. Điểm đụng lõi

| Phần lõi | Cần thay đổi gì, vì sao | Nhãn |
| --- | --- | --- |
| Danh sách lệnh của TUI | Thêm bốn lệnh vào danh sách lệnh (gợi ý khi gõ "/", `/help`); sửa mô tả `/memory` cho có "sửa, xuất" (YC-001, YC-023) | `blocked-by-core` |
| Bộ điều phối lệnh và lịch sử ô nhập của TUI | Nhận ra lệnh memory **trước** khi lưu lịch sử ô nhập ở đường gửi, và ở đường xoá ô (Esc hai lần, Ctrl+C), để chỉ lưu tên lệnh; chuyển lệnh memory tới form (YC-003, YC-026). Đây là C-3 (phần lệnh) của §C11 | `blocked-by-core` |
| Trạng thái hộp thoại của TUI | Thêm các hộp thoại form vào danh sách hộp thoại mở được (YC-008 tới YC-011) | `blocked-by-core` |
| Hộp thoại `/memory` của sổ ghi nhớ | Thêm sửa, đổi trạng thái, xuất (YC-023 tới YC-025). Hộp thoại này do spec 002 thêm, nằm trong phần TUI | `blocked-by-core` |
| Các hộp thoại form mới | Bốn form và màn hình chỗ khác nhau; file mới trong phần TUI, gọi tay cầm quản trị của sổ ghi nhớ | `blocked-by-core` (file mới, nhưng nằm trong TUI của chủ repo) |

Không đổi: hợp đồng `MemoryProvider`, vòng agent, lắp prompt, lưu phiên, nén hội thoại, `/config`, memory cũ (`FileMemory`). Tay cầm quản trị được mở rộng thêm thao tác ghi; đó là code memory của spec 002, không phải lõi.

## 8. Phạm vi

**Trong phạm vi:**
- Story 1 tới 8, YC-001 tới YC-030.
- Mở rộng tay cầm quản trị của sổ ghi nhớ thêm các thao tác ghi kho đã có (thêm, sửa, đổi trạng thái, tạo chủ đề và bí danh, ghi quyết định) và đọc bản hiện hành để điền form.
- Kiểm trùng nguyên văn sau chuẩn hoá và cảnh báo câu dạng cấm đoán (K7 lớp 1–3, phần làm được không cần model).

**Ngoài phạm vi** (kể cả các mục "Để sau" liên quan):
- **Thẻ gợi ý** (model đề xuất, thẻ mở form): spec 007. Spec này chỉ làm form để spec 007 dùng lại.
- **`/memory quet`:** đã bỏ (29/10/2026).
- **Kiểm mâu thuẫn theo nghĩa** giữa ràng buộc và bài học (ví dụ "Không dùng margin" với bài học "Dùng margin khi thị trường tăng"): cần hiểu nghĩa, tức cần model, mà đường ghi không gọi model. Bản đầu chỉ có kiểm trùng nguyên văn (YC-018) và form `/nho` hiện danh sách ràng buộc đang có để người dùng tự thấy.
- **Thao tác "chuyển ngăn" trong `/memory`** (K7 lớp 4, đổi một bài học đã lưu thành ràng buộc): người dùng làm được bằng tạo ràng buộc rồi xoá bài học; thêm thao tác riêng khi có nhu cầu. Chuyển ngăn **lúc lưu** thì có (Story 5 kịch bản 2).
- **Ràng buộc độc lập với công tắc memory, gửi cho agent con, hoãn lượt khi đọc lỗi, file mẫu `INVESTOR.md`:** spec 005.
- **Che khối cũ trong lịch sử khi sửa hoặc xoá:** spec 006.
- **Đổi ngành của chủ đề đã có, thôi dùng bí danh, xoá chủ đề:** kho chưa có thao tác đổi ngành và xoá chủ đề; thôi dùng bí danh để sau cùng việc quản lý bí danh.
- **Xuất lịch sử các bản** (bản 1, 2, 3 của luận điểm): bản đầu chỉ xuất bản hiện hành.
- **Nhập lại từ file Markdown** vào kho: không có; file xuất chỉ để đọc.
- **Tên lệnh có dấu** (`/nhớ`, `/luậnđiểm`): chỉ nhận tên không dấu.
- **Để sau (§C13, Q4, Q7):** mã gõ sai; chủ đề xuất hiện giữa lượt; ISIN; nhập ràng buộc cũ từ `INVESTOR.md`; đánh giá lại quyết định; chia sẻ quyết định.
- **Memory cũ (`FileMemory`):** giữ nguyên, không sửa; gỡ hẳn là việc nợ làm cuối.

## 9. Giả định

- Tên lệnh theo lộ trình và design v5 §6: `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh`. Đã kiểm danh sách lệnh hiện có (lệnh dựng sẵn, bốn lệnh playbook ultradesk `kiem-chung`, `nganh`, `sang-loc`, `tranh-bien`, lệnh MCP luôn có tiền tố máy chủ): không trùng.
- Tên người dùng thấy là "Sổ ghi nhớ" (spec 002); không câu nào người dùng hay model thấy dùng chữ "v5.1".
- Lệnh memory không chiếm một lượt hội thoại và không vào file phiên, nên mở lại phiên không thấy lệnh đã gõ. Câu báo "Đã lưu …" là thông báo của giao diện, không phải dòng hội thoại.
- Phiên bản bộ ràng buộc gắn vào quyết định là bản tại lúc ghi, do kho đọc trong cùng lần ghi (spec 001 YC-019). Form quyết định không hiện ràng buộc, nên không có "bản ràng buộc form đã hiển thị" để gắn.
- Với chủ đề mới loại "mã", bí danh chính lưu viết hoa; loại "ngành", "thị trường" lưu như người dùng gõ. Tên hiển thị là bí danh đang dùng gần nhất (spec 001).
- Danh sách câu dạng cấm đoán cho cảnh báo lệch ngăn là một bảng cố định trong code memory, so trên chữ đã bỏ dấu và hoa thường; thêm mẫu là thêm một dòng cộng một ca test. Cảnh báo không chặn, nên câu nhầm cảnh báo chỉ tốn một lần bấm.
- Kiểm trùng (YC-018) chỉ cảnh báo, vì hai mục giống chữ có thể có ý khác nhau ở phạm vi hay ngoại lệ.
- Tạo chủ đề và lưu nội dung (luận điểm, bài học, quyết định) có thể là hai lần ghi; nếu lần sau lỗi thì chủ đề rỗng ở lại (xem §3). Plan chọn gộp một transaction nếu kho cho phép mà không đổi hình dạng thao tác của spec 001.
- Phím tắt, bố cục form, câu chữ chính xác của câu báo chốt ở plan; các câu trong spec là mẫu để test so.
- Thời gian chờ quyền ghi của kho là 1 giây (spec 001), dưới mốc 2 giây của giao diện.

## 10. Kiểm chất lượng

**Tự kiểm vòng 1 (bản nháp đầu, 03/11/2026):**

| Mục | Kết quả |
| --- | --- |
| Không có chi tiết cài đặt (tên hàm, file, SQL) | Đạt. Nhắc tên lệnh và tên màn người dùng thấy (`/nho`, `/memory`, `/config`), `memory_read` (tên tool đã chốt). §7 nêu phần lõi theo khối chức năng, không nêu file |
| Mọi yêu cầu kiểm thử được, không mơ hồ | Đạt, trừ ba chỗ chờ người dùng chốt (YC-019, YC-025, YC-026); mỗi chỗ đã có phần kiểm được chung cho mọi phương án |
| Mọi yêu cầu dẫn nguồn | Đạt |
| Mỗi user story có Cho/Khi/Thì với ví dụ cụ thể | Đạt (kho ví dụ dùng chung với spec 002) |
| Có tình huống biên và lỗi | Đạt (§3: kho bận, đọc lỗi khi mở form, lưu lỗi, tạo chủ đề rồi lưu lỗi, ký tự đặc biệt, mã gõ sai, Esc khi đang sửa, Enter, Windows, xuất lỗi; Story 6 xung đột; Story 8 sổ không dùng được) |
| Phạm vi có giới hạn, có "Ngoài phạm vi" | Đạt |
| Không mâu thuẫn "Đã chốt" hay bất biến | Đạt. Kiểm mâu thuẫn theo nghĩa (ADR 0005 mục 6) chỉ làm phần trùng nguyên văn; phần theo nghĩa ghi ở "Ngoài phạm vi" kèm lý do (đường ghi không gọi model) |
| Điểm đụng lõi liệt kê, gắn `blocked-by-core` | Đạt: 5 dòng, đều trong phần TUI |
| Không quá 3 chỗ `[CẦN LÀM RÕ]` | Đạt: 3 chỗ (Story 8 / YC-026; YC-019; Story 7 kịch bản 4 / YC-025) |

**Vòng 2 (03/11/2026, sau khi người dùng trả lời):** người dùng chọn phương án đề xuất ở cả ba chỗ:

| Chỗ | Phương án đã chốt | Đã sửa |
| --- | --- | --- |
| 1. Lệnh memory khi `/config` "Tắt" hoặc "Memory cũ" | Báo, không mở form, không đổi cấu hình; giữ chữ trong ô nhập | Story 8 kịch bản 1–3, YC-026 |
| 2. Giá, số liệu, dự báo | Dòng hướng dẫn cố định cộng cảnh báo mềm (không chặn) với dạng giá tiền hoặc dự báo; không cảnh báo chỉ vì có số hay phần trăm | YC-019, Story 3 kịch bản 8, TC-016, §6 |
| 3. Xuất Markdown | File trong thư mục xuất của app (ngoài workspace); mặc định không có quyết định; muốn kèm phải bật từng lần, có cảnh báo | YC-025, Story 7 kịch bản 4–5, TC-010, §6 |

Kiểm lại 9 mục: đạt cả 9. Không còn chỗ `[CẦN LÀM RÕ]`.

**Vòng 3 (04/11/2026, sau duyệt cổng 1):** Story 3 kịch bản 9 cũ dùng ví dụ HPG, mà HPG là bí danh đang dùng của chính HPG, nên không minh hoạ được ca "bí danh đã thôi dùng của chủ đề khác". Thêm chủ đề #9 (bí danh "XYZ", từng là "ABC") vào kho ví dụ; viết lại kịch bản 9 với `/luandiem ABC`, nêu câu báo và đầu ra khi lưu (chủ đề mới, #9 không đổi), giữ ca bí danh đang thuộc chủ đề khác; TC-006 sửa theo. Đã kiểm kho: chỉ bí danh đang dùng phải duy nhất, bí danh đã thôi dùng dùng lại được. Kiểm lại 9 mục: đạt cả 9.
