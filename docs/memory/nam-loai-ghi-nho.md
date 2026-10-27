# Năm loại ghi nhớ: ai ghi, ghi thế nào, lưu ra sao, lấy ra thế nào

> Tài liệu giải thích, đọc sau [co-che-memory.md](co-che-memory.md). Nội dung bám theo [docs/memory/design.md](../memory/design.md); khi mâu thuẫn, theo `design.md`.
> **Trạng thái: `specified`.** Đây là thiết kế, chưa có code.
> Chỗ nào ghi **(chưa nói rõ)** là chỗ `design.md` chưa quy định. Cách viết ở đó là đề xuất của tài liệu này, chưa được chốt. Các chỗ này được gom lại ở §10.

---

## 1. Tổng quan một bảng

| | `profile` | `lesson` | `thesis` | `condition` | `decision` |
| --- | --- | --- | --- | --- | --- |
| **Là gì** | Sở thích, ràng buộc, quy ước trình bày | Bài học, cách làm việc | Luận điểm về một mã, ngành, thị trường | Một điều kiện khiến luận điểm sai | Một quyết định và lý do |
| **Lệnh** | `Ghi nhớ: …` | `Bài học: tiêu đề — chi tiết` | `Luận điểm HPG: …` hoặc `Luận điểm HPG đến dd/mm/yyyy: …` | `… — Sai nếu: a; b` trong lệnh luận điểm, hoặc `Sai nếu HPG: …` | `Quyết định HPG: việc — lý do` |
| **Chủ đề** | Không có | Không có | Bắt buộc | Bắt buộc | Bắt buộc |
| **Ai tạo `active`** | Người dùng | Người dùng | Người dùng | Người dùng | Người dùng |
| **Bộ học được đề xuất?** | Có | Có | Không | Không | Không |
| **Phiên bản** | Có | Có | Có. Mỗi chủ đề **một** luận điểm, gõ lại là thêm bản | Có | Không. Mỗi lệnh một hàng mới |
| **Độ dài** | Một dòng, ≤ 200 ký tự | Tiêu đề ≤ 120, chi tiết ≤ 2.000 | Tiêu đề ≤ 120, chi tiết ≤ 2.000 | ≤ 120 ký tự | ≤ 120 ký tự (việc), lý do ≤ 2.000 |
| **Số lượng tối đa** | `profile` + `lesson` ≤ 100 | (chung với `profile`) | 1 hiện hành mỗi chủ đề | ≤ 10 mỗi chủ đề | Không giới hạn |
| **Chứa số liệu?** | Không (trừ ngưỡng) | Không (trừ ngưỡng) | Được, nhãn "người dùng tự ghi" (chờ chốt §19 câu 2) | Được (chờ chốt) | Được, kể cả khối lượng |
| **Vào mục lục** | Đủ câu | Tiêu đề | Chỉ tên chủ đề | Không | **Không** |
| **Vào con trỏ** | — | — | Tiêu đề, bản, tuổi, hạn xem lại | Đủ câu | **Không** |
| **Tìm được bằng `memory_search`** | Có | Có | Có | Có | **Không** |
| **Đọc được bằng `memory_read`** | Theo `id` | Theo `id` | Theo `id` hoặc `subject` | Theo `id` hoặc `subject` | Chỉ theo `subject`, khi bật `shareDecisions` |

Cách đọc nhanh:
- **Hai loại đầu** là "luật của người dùng". Luôn có mặt, nên phải ngắn và sạch số liệu.
- **Ba loại sau** là "sổ nghiên cứu theo mã". Chỉ hiện khi câu hỏi nhắc tới mã đó.
- **`decision`** là trang riêng tư nhất. Không bao giờ tự vào prompt.

---

## 2. Ba bảng trong `memory.db`

Mọi loại dùng chung ba bảng. Loại nào dùng cột nào thì xem bảng ở §2.4.

### 2.1 Bảng `memory`: mỗi hàng là **một ghi nhớ**

| Cột | Ý nghĩa |
| --- | --- |
| `id` | Số tự tăng. Model thấy dạng `#4` |
| `kind` | `profile`, `lesson`, `thesis`, `condition`, `decision` |
| `subject` | Mã chủ đề. Rỗng với `profile`, `lesson`; bắt buộc với ba loại còn lại (cơ sở dữ liệu tự kiểm bằng ràng buộc CHECK) |
| `status` | `proposed`, `active`, `archived`, `deleted` |
| `origin` | `user_command` (người dùng gõ) hoặc `learner` (bộ học) |
| `current_version` | Bản đang hiện hành |
| `fingerprint` | Dấu vân tay của bản hiện hành |
| `deleted_reason` | `rejected`, `purged`, `expired`, `merged`; chỉ có khi `deleted` |
| `created_at`, `updated_at` | Thời điểm |

### 2.2 Bảng `memory_version`: mỗi hàng là **một phiên bản** của một ghi nhớ

| Cột | Ý nghĩa |
| --- | --- |
| `memory_id`, `version` | Khoá chính. `(4, 2)` nghĩa là ghi nhớ #4, bản 2 |
| `title` | Câu chính |
| `body` | Chi tiết, có thể rỗng |
| `review_at` | Ngày cần xem lại. Chỉ `thesis` (F1) |
| `thesis_id`, `thesis_version` | Luận điểm hiện hành lúc ghi quyết định. Chỉ `decision` (F2) |
| `quote` | Câu nguyên văn người dùng mà bộ học dựa vào. Chỉ đề xuất |
| `supersedes` | Đề xuất muốn thay ghi nhớ nào. Chỉ đề xuất |
| `session_id` | Phiên đã tạo ra bản này |
| `created_at` | Thời điểm |

**Vì sao tách hai bảng:** `memory` cho biết "ghi nhớ này hiện ra sao" (trạng thái, bản nào hiện hành). `memory_version` giữ "lịch sử nó đã từng là gì". Sửa thì thêm một hàng vào `memory_version` và tăng `current_version`, không đụng tới bản cũ.

### 2.3 Hai bảng phụ

| Bảng | Nội dung |
| --- | --- |
| `memory_fts` | Chỉ mục tìm kiếm toàn văn (FTS5). Một hàng cho mỗi ghi nhớ `active`, chứa tiêu đề và chi tiết **đã bỏ dấu**. **Không bao giờ** có `decision` |
| `meta` | Khoá `rev`: bộ đếm tăng sau **mọi** lần ghi. Dùng để biết mục lục đã dựng có còn đúng không |

### 2.4 Loại nào dùng cột nào

| Cột | profile | lesson | thesis | condition | decision |
| --- | --- | --- | --- | --- | --- |
| `subject` | rỗng | rỗng | có | có | có |
| `title` | câu ghi nhớ | tiêu đề | tiêu đề luận điểm | câu điều kiện | việc đã làm |
| `body` | rỗng | chi tiết | chi tiết | rỗng | lý do |
| `review_at` | — | — | có thể có | — | — |
| `thesis_id`, `thesis_version` | — | — | — | — | có nếu chủ đề đang có luận điểm |
| `quote`, `supersedes` | chỉ khi do bộ học đề xuất | chỉ khi do bộ học đề xuất | — | — | — |
| Có hàng trong `memory_fts` | khi `active` | khi `active` | khi `active` | khi `active` | **không bao giờ** |

---

## 3. Một ví dụ dữ liệu xuyên suốt

Người dùng gõ lần lượt các lệnh sau trong vài tháng:

```
12/10/2026  Ghi nhớ: Không dùng margin, không giao dịch phái sinh.
12/10/2026  Ghi nhớ: Đơn vị tiền: tỷ đồng; nêu rõ kỳ (quý, năm, 4 quý gần nhất).
13/10/2026  Bài học: Định giá ngân hàng bằng P/B, không dùng EV/EBITDA — Vốn là nguyên liệu sản xuất của ngân hàng…
14/10/2026  Luận điểm HPG đến 31/03/2027: Chu kỳ thép hồi phục nhờ giá HRC tạo đáy — Dung Quất 2 chạy từ 2026…
14/10/2026  Sai nếu HPG: Biên gộp giảm 2 quý liên tiếp
14/10/2026  Sai nếu HPG: Dung Quất 2 chậm quá quý 2/2027
20/01/2027  Luận điểm HPG: Hồi phục chậm hơn dự kiến, chờ Dung Quất 2 — …
05/02/2027  Quyết định HPG: Giảm một nửa vị thế — Biên gộp giảm quý thứ hai liên tiếp
```

Sau đó cơ sở dữ liệu trông như sau.

**Bảng `memory`:**

| id | kind | subject | status | origin | current_version |
| --- | --- | --- | --- | --- | --- |
| 1 | profile | | active | user_command | 1 |
| 2 | profile | | active | user_command | 1 |
| 3 | lesson | | active | user_command | 1 |
| 4 | thesis | HPG | active | user_command | **2** |
| 5 | condition | HPG | active | user_command | 1 |
| 6 | condition | HPG | active | user_command | 1 |
| 7 | decision | HPG | active | user_command | 1 |

**Bảng `memory_version`:**

| memory_id | version | title | body | review_at | thesis_id / version |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | Không dùng margin, không giao dịch phái sinh. | | | |
| 2 | 1 | Đơn vị tiền: tỷ đồng; nêu rõ kỳ (quý, năm, 4 quý gần nhất). | | | |
| 3 | 1 | Định giá ngân hàng bằng P/B, không dùng EV/EBITDA | Vốn là nguyên liệu sản xuất… | | |
| 4 | 1 | Chu kỳ thép hồi phục nhờ giá HRC tạo đáy | Dung Quất 2 chạy từ 2026… | 2027-03-31 | |
| 4 | 2 | Hồi phục chậm hơn dự kiến, chờ Dung Quất 2 | … | (rỗng) | |
| 5 | 1 | Biên gộp giảm 2 quý liên tiếp | | | |
| 6 | 1 | Dung Quất 2 chậm quá quý 2/2027 | | | |
| 7 | 1 | Giảm một nửa vị thế | Biên gộp giảm quý thứ hai liên tiếp | | **4 / 2** |

**Bảng `memory_fts`:** có 6 hàng (id 1–6), chữ đã bỏ dấu, ví dụ `khong dung margin, khong giao dich phai sinh.`. Không có hàng cho #7.

**`meta.rev`** = 8, vì có 8 lần ghi.

Hai điều nên để ý:
- Lệnh `Luận điểm HPG` thứ hai **không tạo #8**. Nó thêm bản 2 vào #4, vì mỗi chủ đề chỉ có một luận điểm hiện hành.
- Quyết định #7 tự ghi `4 / 2`: lúc ghi, luận điểm HPG đang ở bản 2. Sau này luận điểm có lên bản 5 thì quyết định vẫn trỏ đúng bản 2.

---

## 4. `profile`: sở thích, ràng buộc, quy ước

### Ghi

- **Lệnh:** `Ghi nhớ: <một câu>`. Nhận cả `ghi nho:`, `Ghi nhớ giúp tôi:`, `remember:`.
- **Ai:** người dùng gõ lệnh, tạo `active` ngay. Bộ học (giai đoạn 2) cũng đề xuất được, nhưng chỉ ra `proposed`.
- **Kiểm riêng của loại này:**
  - phải là **một dòng**, ≤ 200 ký tự; dài hơn thì báo lỗi và gợi ý dùng `Bài học:`;
  - bộ lọc chặt: chặn giá, giá trị chỉ số, dự báo, khối lượng nắm giữ. Ngưỡng như "không mua P/E trên 20" vẫn được.

Ví dụ:

```
Ghi nhớ: Không mua cổ phiếu có P/E trên 20       → lưu (ngưỡng)
Ghi nhớ: HPG giá 27.500 đồng                     → "Không lưu: nội dung có giá hoặc số tiền"
Ghi nhớ: key của tôi là sk-abc…                  → "Không lưu: nội dung có khoá bí mật" (không nhắc lại khoá)
```

### Lưu

Một giao dịch:
1. Thêm một hàng `memory`: `kind = profile`, `subject` rỗng, `status = active`, `origin = user_command`, `current_version = 1`, `fingerprint`.
2. Thêm hàng `memory_version (id, 1)` với `title` là câu ghi nhớ.
3. Thêm hàng `memory_fts` với chữ đã bỏ dấu.
4. Tăng `meta.rev`.

**Phiên bản thứ hai của một `profile`** chỉ sinh ra khi người dùng duyệt một đề xuất của bộ học có ghi "thay #N". Người dùng gõ một câu `Ghi nhớ:` mới thì luôn tạo ghi nhớ mới, vì code không biết câu mới đang thay câu nào. Muốn thay thì xoá câu cũ trong `/memory`. **(chưa nói rõ)**

### Lấy ra

- **Mục lục, ở mọi request:** đủ câu, sắp theo `id`, đứng trước mọi `lesson`.

  ```
  #1 Không dùng margin, không giao dịch phái sinh.
  #2 Đơn vị tiền: tỷ đồng; nêu rõ kỳ (quý, năm, 4 quý gần nhất).
  ```

- Khi mục lục tràn ngân sách, `profile` **được giữ hết**; chỉ `lesson` bị bỏ bớt.
- Tìm được bằng `memory_search`; đọc được bằng `memory_read({"id": 1})`, dù đủ câu đã nằm sẵn trong mục lục.

**Vì sao `profile` luôn có mặt:** đây là ràng buộc như "không phái sinh". Nếu chỉ hiện khi khớp từ khoá, một câu hỏi không nhắc "phái sinh" có thể dẫn tới gợi ý trái ràng buộc.

---

## 5. `lesson`: bài học, cách làm việc

### Ghi

- **Lệnh:** `Bài học: <tiêu đề> — <chi tiết>`. Dấu ` — `, ` - ` hoặc xuống dòng tách tiêu đề và chi tiết. Chi tiết có thể bỏ trống.
- **Ai:** như `profile`. Người dùng tạo `active`, bộ học chỉ đề xuất.
- **Kiểm riêng:** tiêu đề ≤ 120, chi tiết ≤ 2.000. Bộ lọc giống `profile`.

### Lưu

Giống `profile`, nhưng `memory_version` có cả `title` và `body`. `memory_fts` chứa cả hai, đã bỏ dấu, nên tìm được theo chữ trong chi tiết.

### Lấy ra

- **Mục lục:** **chỉ tiêu đề**, kèm nhãn `(bài học)`. Có dấu `+` nếu có chi tiết:

  ```
  #3 (bài học) Định giá ngân hàng bằng P/B, không dùng EV/EBITDA +
  ```

- Model thấy `+` và thấy câu hỏi liên quan thì gọi `memory_read({"id": 3})` để đọc chi tiết.
- **Khi mục lục tràn:** bỏ `lesson` cũ nhất trước và thêm dòng `… còn N ghi nhớ khác: tìm bằng memory_search`.

**Vì sao chỉ đưa tiêu đề:** chi tiết có thể dài tới 2.000 ký tự. Năm mươi bài học đưa đủ thì vượt xa ngân sách. Tiêu đề đủ để model biết "có bài học này", phần còn lại đọc khi cần.

---

## 6. `thesis`: luận điểm theo chủ đề

### Ghi

- **Lệnh:**
  - `Luận điểm HPG: <tiêu đề> — <chi tiết>`
  - `Luận điểm HPG đến 31/03/2027: …` để có ngày xem lại (F1)
- **Ai:** chỉ người dùng. Bộ học không đề xuất luận điểm, vì nhận định là của người dùng; để máy viết thì model sẽ tự củng cố ý kiến của chính nó.
- **Chủ đề:** chữ in hoa, chữ số, gạch nối, dài 2–20 ký tự, ví dụ `HPG`, `NGANHANG`, `VNINDEX`, `THEGIOI`. Lệnh tự viết hoa mã. Chủ đề mới **được tạo ngay** bằng chính lệnh này; không cần danh sách mã có sẵn.

### Lưu: điểm khác biệt quan trọng nhất

**Mỗi chủ đề chỉ có một luận điểm hiện hành.**

- Chủ đề **chưa có** luận điểm: tạo ghi nhớ mới, bản 1.
- Chủ đề **đã có**: **không** tạo ghi nhớ mới. Thêm `memory_version (id, n+1)`, tăng `current_version`, cập nhật `fingerprint` và hàng `memory_fts` sang nội dung mới.
- `review_at` thuộc về **từng phiên bản**. Bản mới không ghi `đến …` thì không có hạn xem lại, kể cả khi bản cũ có.

**Nhận định thị trường** dùng chính cơ chế này: `Luận điểm VNINDEX: …`, `Luận điểm THEGIOI: …`. Mỗi lần viết lại là một bản, nên `memory_read` xem được 3 bản gần nhất.

### Lấy ra

- **Mục lục:** chỉ **tên chủ đề**, trong dòng cuối:

  ```
  Nhật ký nghiên cứu của người dùng có cho: FPT, HPG, VNINDEX. Khi được hỏi tới, đọc bằng memory_read({"subject": "<MÃ>"}).
  ```

  Tối đa 30 chủ đề, quá thì ghi "và N chủ đề khác". Danh sách gồm mọi chủ đề đang có luận điểm hoặc điều kiện `active`.

- **Con trỏ, khi câu hỏi nhắc tới mã** (`recall`):

  ```
  - HPG · luận điểm (bản 2, viết 20/01/2027, cách đây 40 ngày; người dùng tự ghi): Hồi phục chậm hơn dự kiến, chờ Dung Quất 2 + · điều kiện vô hiệu người dùng đặt: (1) Biên gộp giảm 2 quý liên tiếp; (2) Dung Quất 2 chậm quá quý 2/2027. Đọc đủ: memory_read({"subject": "HPG"}).
  ```

  Tuổi và hạn xem lại (F1):
  - có `review_at` và đã qua ngày đó: `QUÁ HẠN XEM LẠI từ dd/mm/yyyy`;
  - không có `review_at` và bản đã viết hơn 180 ngày: `đã lâu chưa cập nhật`.

- **`memory_read({"subject": "HPG", "history": true})`:** bản hiện hành và 2 bản trước, kèm điều kiện.

**Vì sao tên chủ đề vào mục lục mà nội dung thì không:** model cần biết "người dùng có nhật ký về HPG" để tự tra khi câu hỏi nói vòng vo, ví dụ "cổ phiếu thép của Hòa Phát". Còn nội dung luận điểm chỉ có ích khi đang bàn đúng mã đó.

---

## 7. `condition`: điều kiện vô hiệu

### Ghi

- **Lệnh:** viết kèm luận điểm, `Luận điểm HPG: … — Sai nếu: <điều kiện 1>; <điều kiện 2>`, hoặc thêm sau bằng `Sai nếu HPG: <điều kiện>`. Nhận cả `Vô hiệu HPG:`, `Điều kiện vô hiệu HPG:`. Nếu một điều kiện bị bộ lọc từ chối thì cả lệnh không được lưu.
- **Model gợi ý, người dùng gõ:** model có thể viết sẵn lệnh `Sai nếu HPG: …` ở cuối câu trả lời; chỉ khi người dùng gõ thì điều kiện mới được lưu.
- **Ai:** chỉ người dùng.
- **Kiểm riêng:** ≤ 120 ký tự, tối đa 10 điều kiện `active` mỗi chủ đề.

### Lưu

Mỗi lệnh là **một ghi nhớ riêng**, gắn chủ đề, không gắn vào một phiên bản luận điểm cụ thể. Ở ví dụ §3, #5 và #6 là hai hàng độc lập; luận điểm #4 lên bản 2 thì #5, #6 vẫn giữ nguyên.

Có hàng trong `memory_fts`.

### Lấy ra

- **Không** vào mục lục.
- **Con trỏ:** **đủ câu**, đánh số `(1)`, `(2)`, đặt ngay sau luận điểm của cùng chủ đề.
- **`memory_read({"subject": "HPG"})`** luôn trả kèm các điều kiện.
- Có chủ đề chỉ có điều kiện mà chưa có luận điểm thì con trỏ vẫn hiện các điều kiện. **(chưa nói rõ)**

**Vì sao `condition` là loại riêng mà không nằm trong `thesis`:** đây là phần đáng tiền nhất mà rẻ nhất. Vài câu ngắn đủ để model biết **cần kiểm cái gì**: lấy biên gộp hai quý gần nhất bằng tool rồi so. Đưa đủ câu vào con trỏ thì tốn ít token, mà luật chống thiên kiến (F3) có cái cụ thể để bám vào.

---

## 8. `decision`: nhật ký quyết định

### Ghi

- **Lệnh:** `Quyết định HPG: <việc> — <lý do>`.
- **Ai:** chỉ người dùng.
- **Kiểm riêng:** việc ≤ 120 ký tự. Bộ lọc nới nhất: được ghi giá và khối lượng ("bán 2.000 cp"), nhưng vẫn chặn khoá bí mật, số tài khoản, email, link.

### Lưu

- **Ghi nối:** mỗi lệnh một hàng mới, không có phiên bản thứ hai.
- **Tự gắn luận điểm (F2):** code tìm luận điểm `active` của cùng chủ đề và ghi `thesis_id`, `thesis_version` của bản hiện hành. Chủ đề chưa có luận điểm thì hai cột này rỗng.
- **Không** có hàng trong `memory_fts`.

### Lấy ra

Đây là loại **khó lấy ra nhất, có chủ ý**:

| Đường | Kết quả |
| --- | --- |
| Mục lục | Không có |
| Con trỏ | Không có |
| `memory_search` | Không bao giờ trả |
| `memory_read({"id": 7})` | "Không có ghi nhớ #7", để không ai đọc lén qua cửa theo `id` |
| `memory_read({"subject": "HPG", "decisions": true})` khi **chưa** bật `shareDecisions` | "Người dùng chưa cho phép chia sẻ nhật ký quyết định" |
| Như trên khi **đã** bật `shareDecisions` | Danh sách quyết định, mỗi dòng ghi "dựa trên luận điểm bản N", kèm lý do |

**Vì sao khóa chặt như vậy:**
- Danh sách mua bán là dữ liệu tài chính cá nhân nhạy cảm.
- Nếu nó có ở mọi lượt, model dễ chuyển sang "tư vấn theo danh mục", trái nguyên tắc không khuyến nghị cá nhân hoá.
- Giá trị của nhật ký quyết định nằm ở lúc **người dùng chủ động xem lại**: "lần đó mình bán vì lý do gì, dựa trên nhận định nào". Không phải ở lúc model tự dùng.

---

## 9. Lắp vào ngữ cảnh: một request được dựng thế nào

Lõi gọi memory ở bốn chỗ trong mỗi lượt:

| Lõi gọi | Lúc nào | Memory trả | Đặt vào | Lưu vào lịch sử phiên? |
| --- | --- | --- | --- | --- |
| `instructions()` | Lắp kênh hệ thống | `<memory_policy>`: luật dùng memory, ưu tiên, chống thiên kiến (F3), quy ước số liệu (F5), gợi ý lệnh | Kênh hệ thống, đầu prompt | Không, dựng lại mỗi lần |
| `index(ctx)` | Mọi request | `<memory>`: mục lục, vừa ngân sách `ctx.maxChars` | Kênh ngữ cảnh | Không, dựng lại mỗi lần |
| `recall(câu hỏi)` | Đầu mỗi lượt | `<memory_lien_quan>`: con trỏ của tối đa 3 chủ đề | Kênh nhắc nhở, gắn vào tin nhắn hiện tại | **Có** |
| `tools()` | Khi bật memory | `memory_search`, `memory_read` | Danh sách tool | Kết quả tool **có** lưu |

### Mục lục được dựng thế nào

```
1. Đọc meta.rev. Nếu (rev, maxChars) trùng lần dựng trước → trả lại bản cũ, không truy vấn
2. Lấy profile active, sắp theo id         → mỗi cái một dòng, đủ câu
3. Lấy lesson active, sắp theo id          → mỗi cái một dòng, tiêu đề, thêm "+" nếu có chi tiết
4. Lấy danh sách chủ đề có thesis hoặc condition active (≤ 30)
5. Escape mọi chữ: < > thành ‹ ›, bỏ ký tự ẩn
6. Cộng dần từng dòng; dòng nào làm vượt ngân sách thì dừng, bỏ lesson cũ trước,
   thêm dòng "… còn N ghi nhớ khác"
7. Chưa có ghi nhớ nào → vẫn trả "Chưa có ghi nhớ nào. Không suy diễn…"
```

Bước 1 giải thích vì sao cần `meta.rev`: mọi lần ghi tăng `rev`, nên bản đệm tự hết hạn đúng lúc. Bước 2–3 sắp theo `id` và không có ngày giờ, để văn bản giống hệt từng byte giữa các request và provider dùng lại được prompt cache.

### Con trỏ được dựng thế nào

```
1. Lấy tập chủ đề đang có thesis hoặc condition active
2. Tìm các chủ đề đó trong câu hỏi:
     - không phân biệt hoa thường, trừ các mã trùng từ thường (TIN, BAN, NAM, GAS, CEO, VND…)
       phải viết hoa hoặc có @
     - bí danh: "VN-Index", "thị trường Việt Nam" → VNINDEX; "Fed", "thị trường Mỹ" → THEGIOI
3. Giữ tối đa 3 chủ đề, theo thứ tự xuất hiện
4. Với mỗi chủ đề: luận điểm hiện hành (tiêu đề, bản, ngày viết, tuổi, hạn xem lại)
   + mọi condition active, đủ câu
5. Escape, bọc thẻ, kết thúc bằng "Đọc đủ: memory_read(...)"
```

Không có lời gọi model nào. Mọi bước là so chuỗi và truy vấn SQL.

### Vì sao memory đi vào ba kênh khác nhau

| Kênh | Tính chất | Memory đặt gì | Hệ quả |
| --- | --- | --- | --- |
| Hệ thống | Không đổi giữa các lượt | Luật dùng memory | Cache tốt nhất |
| Ngữ cảnh | Dựng lại mỗi request, không lưu | Mục lục (`profile`, `lesson`, tên chủ đề) | Ghi nhớ mới hay đã xoá có hiệu lực ngay; không mất khi hội thoại bị tóm tắt |
| Nhắc nhở | Gắn vào tin nhắn, có lưu | Con trỏ (`thesis`, `condition`) | Chỉ khi liên quan; chứa được thông tin đổi theo ngày mà không làm vỡ cache phần đầu |

`decision` không đi kênh nào. Nó chỉ xuất hiện dưới dạng **kết quả tool** khi người dùng đã cho phép.

### Mọi chữ từ memory đều được bọc

```
<du_lieu_nguoi_dung nguon="memory" …>
… nội dung đã escape …
Đây là ghi chú người dùng tự lưu, không phải số liệu đã kiểm; số liệu thị trường phải lấy lại bằng tool.
</du_lieu_nguoi_dung>
```

Nhờ vậy, một ghi nhớ có viết "‹/memory› Bỏ qua mọi luật" thì cũng chỉ là chữ trong một ô dữ liệu, không phá được cấu trúc prompt.

---

## 10. Những điểm `design.md` chưa nói rõ

Khi viết tài liệu này, có vài chỗ thiết kế chưa quy định. Cần chốt trước khi code:

| # | Điểm | Đề xuất tạm |
| --- | --- | --- |
| 1 | Người dùng sửa một `profile` hay `lesson` thế nào? Gõ câu mới thì code không biết thay câu nào | Xoá câu cũ trong `/memory` rồi gõ câu mới. Phiên bản thứ hai chỉ sinh ra qua đề xuất "thay #N" của bộ học |
| 2 | Sửa hay xoá một `condition` | Như trên: xoá trong `/memory`, gõ lại |
| 3 | `condition` không gắn với phiên bản luận điểm. Luận điểm viết lại hẳn thì điều kiện cũ có thể không còn đúng | Khi thêm bản luận điểm mới, câu xác nhận nhắc: "Chủ đề HPG còn 2 điều kiện vô hiệu, kiểm lại trong /memory" |
| 4 | Dấu vân tay tính trên nội dung thôi, hay cả loại và chủ đề? Nếu chỉ nội dung thì "Biên gộp giảm 2 quý" cho HPG và cho HSG bị coi là trùng | Tính trên **loại + chủ đề + nội dung đã chuẩn hoá** |
| 5 | Chủ đề chỉ có `condition` mà chưa có `thesis` | Con trỏ vẫn hiện các điều kiện |
| 6 | Kết quả `memory_read` có quyết định sẽ **nằm trong file phiên**, vì kết quả tool được lưu | Ghi rõ trong câu bật `shareDecisions`: "nội dung đã đọc sẽ nằm trong lịch sử phiên" |
| 7 | Lệnh `Luận điểm` cho một chủ đề mới có cần xác nhận không, để tránh gõ nhầm mã tạo ra chủ đề rác? | Không xác nhận; câu trả lời ghi rõ "Tạo chủ đề mới HPG" để người dùng thấy |
