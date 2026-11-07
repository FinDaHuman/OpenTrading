# Research 007: nén hội thoại, gỡ memory cũ, thẻ gợi ý

Ngày: 07/11/2026. Đọc mã nguồn công khai của các harness tham khảo (Claude Code, Codex, opencode, DeepSeek Harness) và trong repo. Không có mã nguồn Gemini CLI nên không dẫn Gemini.

## Bài học từ các harness

| Harness | Việc | Họ làm (nguồn) | Áp dụng cho 007 |
| --- | --- | --- | --- |
| opencode | Nén | Gọi model tóm tắt với `system: []`, `tools: {}`; AGENTS.md ở phần hệ thống nên không bao giờ tới model tóm tắt; chỉ dẫn tự quay lại mỗi lượt (`packages/opencode/src/session/compaction.ts:429-430`, `session/prompt.ts:1260`) | Bỏ mục lục và `rang_buoc` khỏi request tóm tắt (R-2). Không dựa riêng vào câu dặn trong prompt |
| Codex | Nén | Tin nhắn người dùng giữ lại bỏ các khối chèn nhận ra bằng dấu cố định (`core/src/event_mapping.rs:98-99`, `context/contextual_user_message.rs:19-32`) | Nhận khối bằng nhãn cố định của spec 006, thay bằng dòng nhãn (R-1) |
| Claude Code | Nén | Model tóm tắt là nhánh dùng chung cache nên **thấy** CLAUDE.md và memory; sau nén xoá cache để nạp lại | Làm ngược phần đầu (giấu memory khỏi model tóm tắt), giữ phần sau (dựng lại mục lục sau nén, R-3) |
| opencode, Codex, DeepSeek | Nén | Mẫu tóm tắt có mục "Important Details: constraints/preferences" / "constraints, or user preferences" / "Critical Context" | Bản rút gọn có "Ràng buộc và sở thích" |
| Claude Code, Codex | Nén | Báo model "phiên tiếp tục từ hội thoại đã nén"; Codex phát Warning sau nén | Dòng nhắc nén cho model ở lượt đầu sau nén (R-3) |
| Codex | Thẻ | `<proposed_plan>`, `<oai-mem-citation>` tách khỏi chữ ngay lúc stream, lưu thành mục riêng (`core/src/stream_events_utils.rs:36-58`, `utils/stream-parser`) | Khối `<the_goi_y>` ở cuối câu trả lời, bộ lọc stream, dòng thẻ riêng (R-4, R-5) |
| Codex | Thẻ | Người dùng duyệt luật mạng thì có đoạn báo cho model (`core/src/session/mod.rs:2596-2605`, `NetworkRuleSaved`) | Dòng nhắc kết quả thẻ ở lượt sau (R-7) |
| Claude Code | Thẻ | Báo "đã lưu memory" chỉ cho người dùng, model không thấy | Không làm theo: model phải biết kết quả và biết thẻ đang chờ, nếu không sẽ đề xuất lại |
| Claude Code, opencode, DeepSeek | Thẻ | Tool hỏi người dùng chặn tới khi trả lời | Không hợp với "duyệt sau trong form": thẻ không chặn lượt |
| Codex | Công tắc | `/memories`: "Use memories" và "Generate memories" tách riêng (`tui/src/bottom_pane/memories_settings_view.rs:82-95`) | "Cho phép thẻ gợi ý" tách khỏi bật/tắt Sổ (R-8) |
| Claude Code | Gỡ cái cũ | Chuyển model cũ: khớp đúng giá trị cũ, ghi lại, báo một lần | `"file"` → `"notebook"` (R-6) |
| Codex | Gỡ cái cũ | Cờ đã bỏ giữ làm no-op, báo `DeprecationNotice` lúc mở phiên (`features/src/lib.rs:57-60`, `session.rs:1052-1060`) | Đọc `"file"` không lỗi ở mọi đường, chỉ giao diện ghi lại và báo |
| Claude Code | `/memory` | `/memory` có công tắc auto-memory, mở thư mục memory; cơ chế "#" cũ đã bỏ, không có code chuyển | `/memory` của Sổ hiện trạng thái công tắc thẻ; bỏ màn memory cũ |

## Quyết định kỹ thuật

### R-1. Lược nội dung khối trước khi tóm tắt, trong lõi
- **Chọn:** `summarizeConversation` tự lược phần đầu (`head`) bằng bộ nhận khối của spec 006 (`memoryLines`, `history-blocks.ts`), thay mỗi khối bằng dòng nhãn + câu "nội dung đã lược khỏi bản tóm tắt", trước khi dựng request.
- **Vì sao trong lõi, không ở chỗ gọi:** mọi đường nén (tự động, `/compact`, khi rảnh, khi tràn ngữ cảnh) đều qua hàm này; đặt ở chỗ gọi thì một đường gọi mới quên là lọt.
- **Bỏ:** chỉ dặn trong mẫu (opencode và Codex đều không tin model làm theo); che bản tóm tắt sau khi viết (bản tóm tắt không có nhãn nên không nhận ra chỗ nào là memory).
- Cùng cách thay chữ theo vị trí như che của spec 006 (`redact.ts` `replace`), nên khối nằm giữa kết quả tool không làm hỏng phần còn lại.

### R-2. Request tóm tắt không có mục lục, `rang_buoc`, hướng dẫn memory
- **Chọn:** `summarizeConversation` dựng request với memory và nguồn ràng buộc để trống. Hồ sơ `INVESTOR.md` vẫn đọc như hiện nay.
- **Đánh đổi:** request tóm tắt không còn dùng chung phần đầu hệ thống với lượt thường, nên mất cache của phần đó cho đúng một request. Người dùng chốt bỏ `rang_buoc` (spec §3). Test spec 005 "summary request has the turn's exact system part" đổi kỳ vọng có chủ đích.

### R-3. Dấu "vừa nén" đọc từ lịch sử
- **Chọn:** sổ nhận ra dấu nén (`isCompactMarker`) trong lịch sử, lấy một mã ngắn từ bản tóm tắt đứng sau nó (băm 6 ký tự của chữ bản tóm tắt, ổn định qua mở lại phiên). Dòng nhắc nén mang mã đó. Có dấu nén mà chưa có dòng nhắc mang mã của nó ở sau thì nói.
- **Vì sao:** không cần lõi báo sự kiện cho memory (giữ hợp đồng nhỏ), đúng qua khởi động lại và mở lại phiên, và hai lần nén gần nhau có mã khác nhau (spec Story 3 kịch bản 6).
- Mã nén khác mã nén sổ đã thấy thì bỏ ghim mục lục (spec 006 sửa review điểm 4), nên mục lục dựng lại ở request đó.

### R-4. Khối thẻ dạng dòng `trường: giá trị`, không JSON
```
<the_goi_y loai="bai_hoc">
tieu_de: Không mua đuổi khi giá đã tăng mạnh
tom_tat: Giá tăng quá 7% trong phiên thì chờ, không mua đuổi.
</the_goi_y>
```
- **Vì sao:** model nhỏ hay lỗi JSON (dấu ngoặc, escape tiếng Việt); một trường một dòng dễ kiểm và dễ ghi rõ lỗi. Tên tag và tên trường tiếng Việt không dấu, cùng kiểu với các tag hiện có (`nhac_nho`, `memory_lien_quan`).
- Một khối duy nhất, đứng cuối cùng (sau nó chỉ còn khoảng trắng). Không nhận trong code fence hay dòng trích dẫn (`>`).

### R-5. Tách thẻ ở lõi, ẩn lúc stream ở giao diện
- **Lõi** (`runAgent`, cùng chỗ bỏ dòng todo lặp lại): ở **mọi** lượt, tách mọi khối `<the_goi_y …>…</the_goi_y>` khỏi chữ câu trả lời trước khi vào lịch sử (kể cả khi thẻ tắt, model hạng C, hay model bắt chước khối cũ). Chỉ khi lượt bật thẻ: khối ở cuối câu trả lời cuối được kiểm, hợp lệ thì phát sự kiện `card` (chưa có id) trước `done`. Khối không đóng: bỏ dòng mở, giữ chữ phía sau.
- **Giao diện gán id và lọc trùng:** lõi không biết mã lượt (spec 006 gán khi lượt vào hàng ghi) và không giữ thẻ của phiên, nên giao diện gán `id` và bỏ thẻ trùng thẻ "chờ"/"đã bỏ qua".
- **Giao diện:** bộ lọc stream (một máy trạng thái nhỏ) giữ lại phần chữ có thể là đầu `<the_goi_y`; khi chắc không phải thì thả ra; khi vào khối thì giữ tới thẻ đóng; hết stream hoặc vượt giới hạn độ dài thì thả chữ đang giữ (bỏ dòng mở). Dùng chung hàm tách của lõi khi đóng câu trả lời, để màn hình và lịch sử giống nhau.
- **Vì sao chia hai nơi:** lõi là nơi duy nhất quyết định lịch sử; nhưng stream đi thẳng tới giao diện qua sự kiện `text-delta`, nên chỉ giao diện ẩn được chữ đang hiện.

### R-6. Chuyển cấu hình: hiểu ở mọi nơi, ghi ở giao diện
- Một hàm thuần đọc lựa chọn memory từ cấu hình: `"file"` → `"notebook"`, `"notebook"` → `"notebook"`, còn lại → `"none"`. `createMemory` và `/config` dùng hàm này.
- Giao diện, lúc khởi động, thấy giá trị thô là `"file"` thì ghi `"notebook"` và hiện câu báo trong cùng một bước. Dòng lệnh và bộ chạy đo không ghi (spec YC-010, YC-011).

### R-7. Kết quả thẻ đưa cho sổ qua `MemoryContext`
- `MemoryContext` thêm danh sách thẻ của phiên với trạng thái (mã thẻ, loại, trạng thái, số mục đã lưu). Giao diện giữ danh sách này (dựng từ dòng thẻ khi mở lại phiên).
- Sổ nói mỗi kết quả một lần, so theo lịch sử như mọi dòng nhắc (khoá có mã thẻ). Thẻ "chờ" có dòng nhắc "đang chờ, không đề xuất lại" một lần.
- **Bỏ:** đưa vào nhắc nhở `ultradesk` hay `hook_context` (không có dedupe theo lịch sử, không thuộc memory).

### R-8. Công tắc thẻ và hạng C
- Cấu hình `memory.cards` (mặc định bật). Lõi nhận `cards: true` từ giao diện khi Sổ bật và công tắc bật; lõi tự tắt khi model hạng C. Đoạn hướng dẫn tạo thẻ là một lớp prompt riêng (`prompts/memory-cards.md`), chỉ có khi lượt bật thẻ, để tắt thẻ không đổi phần hướng dẫn sổ còn lại.

### R-9. Chọn thẻ bằng phím
- Thẻ không tự giữ phím: phím người dùng gõ tiếp thuộc về ô nhập (bản đầu tự chọn thẻ khi lượt kết thúc thì ký tự đầu của câu kế tiếp bị nuốt, và câu bắt đầu bằng "x" bỏ qua thẻ; sửa 07/11/2026 trước khi push).
- Lệnh `/goiy` chọn thẻ "chờ" mới nhất; sau đó Enter mở form (có thời gian chờ `GRACE_MS`), `x` bỏ qua, Esc hay phím khác trả phím về ô nhập. Không lấy thao tác gửi tin nhắn làm đồng ý (design-v5 §6).

### R-10. Kiểm câu gốc
- Chuẩn hoá NFC, gộp khoảng trắng, so không phân biệt hoa thường; câu gốc phải là đoạn liền trong chữ người dùng gõ của lượt (`typedText`, đã bỏ thông báo agent con) và dài ít nhất 8 ký tự. Không so mờ: mờ thì nguồn ngoài dễ "khớp".
