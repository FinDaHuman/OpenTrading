# Giao diện: thông báo, dòng đang làm, câu trả lời, dòng chế độ, subagent, /model

Đợt UI/UX 10/2026 (PR #105–#110), thiết kế theo Claude Code, có tham khảo opencode và codex.

## Vùng dưới màn hình

```
 ● Chạy 3 subagent nghien-cuu · ↓ để quản lý               ← lịch sử chat: mỗi nhóm subagent 1 dòng

 ✶ Đang phân tích… (1m 23s · ↓ 4,2k token)                 ← dòng đang làm (chỉ khi agent đang chạy)
   ⎿ Tiếp: So sánh P/E với ngành
 ─ Việc cần làm · 2/5                                       ← todo
 ───────────────────────────────────────────────────────
 › _                                                        ← ô nhập
 ───────────────────────────────────────────────────────
  ▸ sửa có hỏi (shift+tab đổi) · 3 subagent · ↓ quản lý     ✓ Đã copy 42 ký tự
  ● main                                                    ← panel subagent
  ⠹ nghien-cuu  Định giá FPT · valuation_run(FPT)    53s · ↓ 12,4k token
  ◌ vi-mo       Lãi suất VN                          chờ slot (10/10)
 ▲ OpenTrading  Google · gemini-3.5-flash-lite  MCP 1/1     còn 12% tới tự nén
```

## Thông báo

- **Thông báo ngắn** hiện ở bên phải dòng chế độ. Mỗi lúc chỉ hiện một thông báo, các thông báo khác chờ theo mức ưu tiên. Thông báo tự tắt sau vài giây.
  - Thông báo dài hơn chỗ còn trống thì có dòng riêng, tự xuống dòng, không bị cắt.
- **Cảnh báo và lỗi quan trọng** hiện thành thẻ ở góc trên phải, viền màu theo mức độ, tối đa 3 thẻ. Ví dụ: MCP server mất kết nối. Khi server kết nối lại, thẻ đó tự gỡ.
- **Lịch sử chat chỉ giữ những gì cần đọc hoặc copy lại**:
  - output lệnh (danh sách `/undo`, đường dẫn `/export`, `/profile`, hướng dẫn `Dùng: …`);
  - lỗi của lượt; "Đã dừng."; dòng nén hội thoại.
- **Xác nhận một thao tác** (đổi model, lưu key, bật skill, MCP, `/save`, `/undo <số>`…) chỉ là thông báo, không ghi vào lịch sử chat.

## Dòng đang làm

- Nội dung chính là việc trong todo đang làm. Nếu không có todo nào đang làm thì hiện một động từ, ví dụ "Đang soi bảng giá".
- Trong ngoặc là thời gian đã làm và số token model viết ra (từ 100 token trở lên mới hiện).
- Thời gian **dừng đếm** khi agent chờ bạn duyệt hoặc trả lời.
- Nếu 3 giây không có gì mới và không có tool nào đang chạy, biểu tượng chuyển dần sang đỏ: model có thể đang treo.
- Dòng dưới hiện `Tiếp: <việc kế tiếp>`. Nếu không có việc kế tiếp và lượt đã chạy quá 10 giây thì hiện một mẹo; tắt mẹo ở `/config → Mẹo khi chờ`.
- **Retry:** khi provider lỗi tạm thời (503, quá tải, 429…), dòng này đổi thành `△ Provider lỗi tạm thời (503) · thử lại sau 7s (lần 3/4) · esc dừng` và **đếm ngược từng giây**.
  - Retry xong thì dòng trở lại bình thường, không để lại gì trong lịch sử chat.
  - Nếu hết số lần thử thì lỗi của lượt mới được ghi vào lịch sử.
- Lượt dài từ 5 giây trở lên kết thúc bằng `✻ Xong sau 1m 23s` trong lịch sử.

## Câu trả lời đang stream

Câu trả lời được vẽ bằng markdown (đậm, danh sách, bảng, code). Trong lúc model đang viết, chỉ phần đã "chốt" mới được vẽ, để không thấy `**`, `##`, `|` thô rồi mới đổi sang bản đã format:

- Các dòng đã xuống dòng hiện ngay. Dòng đang viết dở hiện kèm con trỏ `▍` nếu là chữ thường hoặc một mục danh sách đã có chữ; nó dừng trước dấu `**`, `` ` ``, `*` chưa đóng.
- Dòng dở là tiêu đề (`#`), dòng bảng (`|`), fence code (```` ``` ````) hay ký hiệu còn đang gõ thì chờ tới khi xuống dòng.
- **Bảng** được giữ lại tới khi viết xong, trong lúc đó hiện `đang dựng bảng… (N hàng)`. Bảng hiện ra một lần, không co giãn cột theo từng hàng.
- Chữ mới được gom và vẽ mỗi 32ms (một khung hình), không vẽ lại theo từng token.

## Dòng chế độ và status bar

- **Dòng chế độ** (ngay dưới ô nhập), từ trái sang phải:
  - chế độ quyền `‖ chỉ đọc` / `▸ sửa có hỏi` / `▸▸ tự động`, kèm `(shift+tab đổi)` khi dòng còn chỗ;
  - số subagent đang chạy;
  - gợi ý phím: `esc dừng` khi agent đang chạy, `? phím tắt · / lệnh` khi rảnh.
- **Status bar** (dòng cuối cùng): provider · model, MCP, skill đang bật.
  - Khi context gần ngưỡng tự nén, status bar hiện `còn N% tới tự nén`.
  - Khi không có gì tự nén nữa (tự nén đã tắt, đã lỗi 3 lần liền, hoặc đã vượt ngưỡng), status bar hiện `context còn N% · /compact` màu đỏ.
- **Lần đầu Shift+Tab tới ▸▸ tự động**, một hộp xác nhận giải thích auto mode, với 3 lựa chọn: Bật / Bật và đặt làm mặc định / Không, quay lại.
  - Trong lúc hộp mở, chế độ quyền chưa đổi.
  - Đoạn giải thích này cũng có trong `/permissions` khi đang ở ▸▸.

## Panel subagent

- Panel liệt kê subagent của phiên: đang chạy, đang chờ slot, và các subagent vừa xong (ở lại 5 giây rồi biến mất).
- Mỗi dòng gồm loại, mô tả, tool đang gọi. Bên phải là thời gian và token, hoặc `chờ slot`, hoặc đếm ngược retry.
- Panel hiện tối đa 5 dòng; terminal thấp thì ít dòng hơn. Phần còn lại hiện `… +N agent`.
- **Phím:**
  - **↓** ở cuối ô nhập (đã qua câu mới nhất trong lịch sử, con trỏ ở dòng cuối) để chọn một dòng;
  - **↑↓** di chuyển;
  - **enter** mở agent trong `/tasks`;
  - **x hai lần** (hoặc **ctrl+x**) dừng agent;
  - **esc** hoặc gõ chữ: quay về ô nhập.
- Trong lịch sử chat, mỗi nhóm subagent chỉ có 1 dòng. **ctrl+o** mở cây chi tiết: yêu cầu, các tool, báo cáo.

## /model

- Thứ tự các nhóm: `★ Yêu thích` → `Gần đây` → từng provider đã kết nối (provider đang dùng đứng đầu).
- **Phím:**
  - **ctrl+f** đánh dấu hoặc bỏ yêu thích;
  - **←/→** nhảy giữa các nhóm khi ô lọc trống;
  - gõ để lọc trên mọi provider.
- Yêu thích không dùng được (provider chưa kết nối, hoặc model không còn trong danh mục) hiện màu xám, kèm lý do.
- Danh sách yêu thích và gần đây lưu ở `~/.opentrading/model.json`.
- Các picker model trong `/config` dùng cùng cách nhóm này.

## Báo cho terminal

Tắt hết các báo dưới đây bằng `/config → Báo khi xong / cần duyệt` (`ui.terminalNotify`).

- **Vòng tiến trình trên tab:** quay khi agent làm, vàng khi chờ bạn. Chỉ bật trên Windows Terminal, ConEmu và Ghostty (OSC 9;4), vì terminal khác có thể hiểu nhầm thành thông báo. Thoát app thì vòng tự tắt.
- **Thông báo desktop:** khi trả lời xong, cần bạn duyệt, model hỏi bạn, hoặc lượt bị lỗi. Chỉ gửi khi cửa sổ terminal **không** được focus, và mỗi loại chỉ một lần cho tới khi bạn quay lại.
- **Trạng thái chương trình (OSC 7501):** gửi cho terminal nào hỗ trợ.

## Cuộn chat

- Lăn chuột: **5 dòng mỗi nấc**. Đổi ở `/config → Tốc độ lăn chuột` (3 → 5 → 8 → tăng tốc khi lăn nhanh), hoặc trong `config.json`: `"ui": { "scrollSpeed": 5 }`, `"ui": { "scrollAcceleration": true }`.
- `PageUp` / `PageDown`: nửa màn hình. `Ctrl+Home` / `Ctrl+End`: đầu / cuối hội thoại (`Home`/`End` trơn vẫn là của ô nhập).
- Đã cuộn lên thì góc dưới hiện `↓ ctrl+end xuống cuối`; có chữ mới trong lúc đó thì đổi thành `↓ có nội dung mới · ctrl+end`. Bấm chuột vào đó cũng xuống cuối. Cuộn về sát cuối thì chat lại tự bám theo chữ mới.
- Nền động (băng giá) chỉ chạy ở màn Home. Vào hội thoại thì nền đứng yên, để màn hình chỉ vẽ lại khi có thay đổi: lăn chuột được vẽ ngay, terminal nhận ít dữ liệu hơn.

## Phím tắt

Gõ `?` khi ô nhập trống để xem bảng phím tắt. Gõ phím bất kỳ để đóng; nếu là chữ thì chữ đó được gõ tiếp vào ô nhập.
