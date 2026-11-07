# Data model 006: file phiên và dữ liệu che

Không đổi lược đồ `memory.db` (vẫn bản 1). Spec này đổi hai chỗ trong file phiên JSONL và thêm vài kiểu dữ liệu chỉ nằm trong RAM.

## 1. File phiên: hai thay đổi

### 1.1 Dòng kết thúc lượt có mã lượt

```json
{"type":"turn_end","ts":"2026-11-06T08:00:00.000Z","turn":3,"provider":"anthropic","model":"…","contextTokens":12345}
```

| Trường | Kiểu | Ràng buộc |
| --- | --- | --- |
| `turn` | số nguyên ≥ 1, không bắt buộc | Số lượt khi lượt vào hàng ghi (cùng số với biên nhận). Tăng dần trong phiên, không dùng lại. Lượt lưu bù giữ số của nó. Dòng ghi trước spec này không có trường này |

Các trường khác giữ nguyên, kể cả `recoveries`, `unanswered`, `retiredTodos`, `dataGaps` của `main`.

**Tính số lượt cuối khi đọc:** đi theo thứ tự các dòng `turn_end`; dòng có `turn` thì lấy số đó, dòng không có thì lấy số trước đó cộng một (bắt đầu từ 0).

Ví dụ: một file cũ có 4 dòng không có số, rồi thêm 2 dòng mới mang số 5, 6. Số cuối là 6, lượt mới mang số 7.

### 1.2 Dòng che (loại dòng mới)

```json
{"type":"redact","ts":"2026-11-06T08:05:00.000Z","items":[{"kind":"lesson","id":7,"versions":[1]},{"kind":"thesis","name":"HPG","versions":[2,3]}]}
```

| Trường | Kiểu | Ràng buộc |
| --- | --- | --- |
| `items` | mảng, ít nhất 1 phần tử | Mỗi phần tử là một mục bị che |
| `items[].kind` | `"lesson"` hoặc `"thesis"` | Chỉ hai loại có khối trong lịch sử |
| `items[].id` | số nguyên | Chỉ với `lesson`: số bài học trong nhãn |
| `items[].name` | chuỗi | Chỉ với `thesis`: tên đúng như trong nhãn (đã escape như trong nhãn) |
| `items[].versions` | mảng số nguyên, ít nhất 1 | Các bản có khối bị che |

Không có nội dung memory trong dòng che.

**Luật áp khi đọc:**
- Một khối bị che khi loại, mục và bản của nó khớp một phần tử của một dòng che nằm **sau** nó trong file.
- Khối nằm trong phần lịch sử của một dòng nén tính theo vị trí của dòng nén đó.
- Dòng che cụt (tắt ngang) hay hỏng bị bỏ qua như mọi dòng hỏng.
- Bộ đọc của bản app trước bỏ qua loại dòng lạ, nên vẫn mở được phiên, nhưng không che.

**Khi nào được ghi:** chỉ khi kho đọc được **và** cho kết quả "đã xoá" (research R-1). Tức là:
- kho có dấu xoá của đúng mục và bản đó; **hoặc**
- kho không có mục hay bản đó (bài học theo số; luận điểm theo mọi bí danh, kể cả đã thôi dùng).

Khối "khác nội dung" (có mục và bản đó, chưa xoá, nhưng nội dung không trùng) **không** làm ghi dòng che: chỉ tạm che trong những gì gửi đi. Khối bị cắt cụt mà mục còn thì không che gì.

Dòng che được ghi ở một trong hai lúc:
- che trong phiên đang mở (đầu lượt, đầu lần nén, ngay sau khi xoá);
- mở lại một phiên.

Không bao giờ ghi khi chỉ đọc (`/export`, tool đọc phiên cũ) hay khi tạm che (kho vắng, kho lỗi, khác nội dung).

## 2. Hàng ghi phiên (RAM, theo spec 004)

Phần chờ ghi có thêm loại `redact`, cạnh `turn` và `compact`. Dòng che xếp sau các phần đã có trong hàng, nên luôn đứng sau những lượt nó che, kể cả lượt đang chờ lưu bù. Một phiên đã "ngừng ghi" (spec 004) thì phần `redact` được đếm nhưng không ghi.

Biên nhận có thêm `pendingRedactions: number`. Hiện `pendingCompactions` được tính bằng "số phần trong hàng trừ số lượt", nên phải đổi sang đếm theo loại. Không đổi thì một dòng che đang chờ sẽ bị báo nhầm là "bản nén chưa lưu".

## 3. Dữ liệu trong RAM

| Tên | Là gì | Ở đâu |
| --- | --- | --- |
| Khối trong lịch sử | `{ kind, ref (số bài học hoặc tên luận điểm), version, channel ("reminder" \| "tool"), location (tin nhắn, phần, đoạn chữ), lines (các dòng nội dung), complete (false khi một dấu cắt của lõi cắt ngang khối) }`. Tách từ lịch sử, mỗi lượt tách lại, không lưu | memory |
| Dòng nhắc, dòng trỏ, dòng lỗi, khối đã che trong lịch sử | `{ kind: "note" \| "pointer" \| "error" \| "masked", key }`, dùng để không gửi lặp (spec YC-004) | memory |
| Kết quả kiểm kho | `checked` (mỗi khối một kết quả: `deleted` \| `mismatch` \| `live`; khối cụt chỉ có thể là `deleted` hoặc `live`) \| `missing` (không có file kho) \| `failed` (lý do) | memory |
| Sổ phiên của provider | Chỉ còn cửa sổ chủ đề tập trung: 3 lượt gõ (lượt này và 2 lượt trước), giữ như code hiện nay. Mọi thứ "đã gửi, đã nhắc, đã trỏ" lấy từ lịch sử | memory |

Không thứ nào trong RAM được coi là "đã lưu".
