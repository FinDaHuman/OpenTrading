# File, shell và chế độ quyền

Agent đọc được file bạn đưa (PDF báo cáo, Excel, CSV, ghi chú, ảnh), tạo file giúp bạn (kế hoạch `.md`, bảng `.csv`, trang `.html` có biểu đồ) và chạy lệnh (ví dụ script Python tính toán). Mọi thao tác ghi đều qua **cổng quyền**, và **chế độ quyền** quyết định ai duyệt. Thiết kế theo Claude Code (permission modes, auto mode), có tham khảo opencode và Codex. PR #91, #92, #94, #95, #96.

## Ba chế độ (Shift+Tab, hoặc Alt+M)

| Chế độ | Đọc file | Ghi / sửa file | Lệnh `shell` | Tool ghi khác (watchlist, tool MCP ghi, trang web domain mới) |
| --- | --- | --- | --- | --- |
| `‖ chỉ đọc` (mặc định) | tự do | hỏi từng lần: **Có, lần này / Có, và chuyển sang ▸ / Không** | hỏi từng lần (như ghi file) | hỏi như trước: lần này / cả phiên / luôn / không |
| `▸ sửa có hỏi` | tự do | hỏi; "cả phiên này" cho cả thư mục (và thư mục con) | hỏi; "cả phiên"/"luôn" cho một **tiền tố lệnh chỉ đọc** như `git status …` | hỏi như trước |
| `▸▸ tự động` | tự do | file **mới** hoặc file do phiên tạo: chạy luôn; file có sẵn: model duyệt | model duyệt | model duyệt |

- Chế độ hiện ở dòng chế độ ngay dưới ô nhập (xem [ui.md](ui.md)). `/config → Chế độ quyền khi mở` để đổi chế độ lúc khởi động (lưu `permissions.defaultMode`).
- Lần đầu chuyển sang `▸▸`, một hộp xác nhận giải thích auto mode (Bật / Bật và đặt làm mặc định / Không, quay lại). Trong lúc hộp mở, chế độ chưa đổi. Đồng ý một lần thì lưu `permissions.autoAcknowledged`. Phiên đặt mở ở `▸▸` mà chưa từng đồng ý sẽ mở ở `▸` rồi hỏi. Đoạn giải thích cũng có trong `/permissions` khi đang ở `▸▸`.
- Ở `‖`, các quyền "cả phiên" hay "luôn cho phép" không được dùng cho ghi file và chạy lệnh: lần nào cũng hỏi. Tool ghi khác vẫn dùng được các quyền đã cho như trước.
- Ký hiệu là `‖ ▸ ▸▸`, không phải `⏸ ✎ ⏵⏵` như trong plan. Lý do: Windows Terminal vẽ `✎` thành emoji màu rộng 2 ô (repo có test cấm), và `⏸` cũng có dạng emoji.
- Model được báo chế độ hiện tại qua khối nhắc `<quyen_tep>`. Khối này gửi lại mỗi khi chế độ hoặc workspace đổi.

## Workspace

- Workspace là thư mục bạn mở OpenTrading. Nếu bạn mở ở home, ở gốc ổ đĩa, ở thư mục hệ thống (`C:\Windows`, `Program Files`, `/usr`…) hay trong `~/.opentrading`, OpenTrading dùng `~/.opentrading/workspace` thay vào.
  - Lý do: Claude Code coi thư mục làm việc là an toàn vì đó thường là repo git, còn thư mục của nhà đầu tư thì thường không phải.
- `/add-dir <thư mục>` thêm thư mục cho phiên này; thêm `--luu` để giữ cho các phiên sau (`config.workspace.dirs`). `/add-dir` không có tham số thì liệt kê workspace.
- Đường dẫn tương đối tính từ thư mục workspace đầu tiên. Đọc thì được ở mọi nơi, ghi ra ngoài workspace thì luôn hỏi.

## Thư mục tạm của phiên (scratchpad)

Mỗi phiên có một thư mục riêng trong thư mục tạm của hệ thống, để agent để script, kết quả trung gian và file xuất không thuộc dự án của bạn, giống Claude Code:

```
%TEMP%\opentrading\<thư mục đang mở>\<mã phiên>\scratchpad      (Windows)
/tmp/opentrading-<uid>/<thư mục đang mở>/<mã phiên>/scratchpad    (macOS, Linux)
```

- Phần `<thư mục đang mở>` là đường dẫn workspace, thay mọi ký tự không phải chữ/số bằng `-` (ví dụ `D--Dau-tu`). Dài quá 60 ký tự thì cắt bớt và thêm mã băm, để đường dẫn trên Windows không vượt 260 ký tự.
- Biến môi trường `OPENTRADING_TMPDIR` đổi thư mục gốc.
- Thư mục được tạo ở lượt chat đầu tiên của phiên (phiên không chat thì không có thư mục), và được tạo lại nếu hệ thống đã dọn `%TEMP%`.
- `/new`, `/clear` chuyển sang thư mục của phiên mới. Mở lại một phiên (`-c`, `--resume`, `/sessions`) dùng thư mục `<mã phiên>` dưới thư mục bạn **đang** mở OpenTrading: `-c` luôn về đúng thư mục cũ; mở phiên của thư mục khác thì được một thư mục tạm mới. Subagent và ultradesk dùng chung thư mục của phiên.
- Model biết đường dẫn qua khối `<quyen_tep>`, được dặn dùng nó thay cho `%TEMP%` hay `/tmp`; file bạn muốn giữ thì vẫn đặt trong workspace.

Quyền:

| Chế độ | Ghi file vào thư mục tạm | Lệnh `shell` chạy trong thư mục tạm |
| --- | --- | --- |
| `‖ chỉ đọc` | hỏi từng lần (như mọi thao tác ghi) | hỏi từng lần |
| `▸ sửa có hỏi` | **chạy luôn, không hỏi** | hỏi như lệnh trong workspace (không còn bị coi là "ngoài workspace") |
| `▸▸ tự động` | **chạy luôn**, không tốn request model duyệt | model duyệt; ghi vào thư mục tạm không bị coi là ghi ra ngoài |

- Quy tắc chặn (`deny`) và quy tắc hỏi (`ask`) của bạn vẫn được áp dụng trước.
- File chứa khoá (`.env`, `*.key`…) trong thư mục tạm vẫn hỏi như ở mọi nơi khác.
- Được ghi tự do là cả thư mục của dự án (`%TEMP%\opentrading\<thư mục đang mở>`), không chỉ thư mục của phiên hiện tại. Nhờ vậy subagent chạy nền từ trước `/new` vẫn ghi tiếp được.
- Symlink hay junction nằm trong thư mục tạm nhưng trỏ ra ngoài thì không được tính là thư mục tạm: kiểm theo cả đường dẫn thật.
- Khác Claude Code: lệnh shell có ghi vào thư mục tạm (ví dụ `python x.py > out.txt`) vẫn được duyệt như mọi lệnh khác, vì OpenTrading không tách đường dẫn ra khỏi tham số của lệnh.
- Tắt tính năng ở `/config → Thư mục tạm của phiên` (lưu `scratchpad.enabled: false`). Khi tắt: không tạo thư mục, model không được báo, không có ngoại lệ quyền.

Dung lượng và dọn dẹp (Claude Code không dọn thư mục tạm của nó và không cảnh báo):

- **Cảnh báo:** lúc một lượt bắt đầu, OpenTrading đo thư mục tạm của dự án ở nền, tối đa 30 phút một lần.
  - Vượt ngưỡng `scratchpad.warnMB` (mặc định 1024 MB; 0 = không báo) thì có một dòng `▲` ngay dưới câu trả lời, kèm đường dẫn và lệnh `/scratch`.
  - Mỗi nấc chỉ báo một lần: 1 GB, rồi 2 GB… Xuống dưới ngưỡng rồi vượt lại thì báo lại.
  - Mỗi lần đo xem tối đa 50.000 mục; nhiều hơn thì dòng báo ghi "hơn …".
- **Tự dọn:** khi mở OpenTrading, thư mục phiên (của mọi dự án) không có thay đổi nào trong `scratchpad.keepDays` ngày (mặc định 30; 0 = không dọn) bị xoá. Dự án hết phiên thì xoá luôn thư mục dự án.
- **`/scratch`:** đường dẫn, dung lượng phiên này và cả dự án, số phiên.
  - `/scratch clear` xoá thư mục của các phiên khác trong dự án, trừ phiên vừa có thay đổi trong 1 giờ qua (có thể là một cửa sổ OpenTrading khác đang mở cùng thư mục).
  - `/scratch clear all` xoá cả phiên này (thư mục được tạo lại rỗng).
- Khi đo và khi xoá, symlink/junction chỉ bị gỡ như một liên kết: không đếm, không đi vào và không xoá thư mục nó trỏ tới.

## Luôn hỏi bạn, không quy tắc hay model nào duyệt thay

- **Đọc file chứa khoá/mật khẩu:**
  - `~/.opentrading/auth.json`, `mcp-auth.json`, `mcp.json`;
  - `.env`, `.env.*` (trừ `.env.example`), `*.pem`, `*.key`, `id_rsa*`;
  - `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, gcloud, hồ sơ trình duyệt, `.git-credentials`, `.netrc`, `.npmrc`;
  - bản sao lưu trong `~/.opentrading/file-history`.

  Lý do: đọc là đã gửi nội dung cho provider LLM. Kiểm theo cả đường dẫn thật, nên một symlink tên vô hại trỏ tới `auth.json` vẫn bị hỏi. Chỉ có "lần này" hoặc "cả phiên, đúng file này", không có "luôn cho phép".
- **Đường dẫn mạng** `\\server\share`: OpenTrading không chạm vào trước khi bạn cho phép, vì chạm vào có thể lộ hash đăng nhập Windows. Đường dẫn Windows dạng lạ (`a.txt:stream`, `\\?\`, `CON`) cũng luôn hỏi.
- **Ghi vào vùng bảo vệ:** `~/.opentrading/**` (trừ `workspace`, vì `config.json` chứa các quy tắc quyền); `.opentrading/`, `.git/`, `.github/`, `.vscode/`, `.idea/`, `.husky/`, `.devcontainer/`, `.ssh/`; `.bashrc`, `.zshrc`, `.profile`, `*profile.ps1`, `.gitconfig`, `.npmrc`, `.mcp.json`; thư mục tự chạy khi đăng nhập. Chỉ có "lần này" hoặc "không".
- **Ghi ra ngoài workspace.**
- **Lệnh shell** nhắc tới những thứ trên hoặc tới `$PROFILE`, Scheduled Task, `-ExecutionPolicy Bypass`, hoặc chạy ở thư mục ngoài workspace.
- **Cảnh báo lặp:** model gọi cùng một tool với cùng tham số 3 lần liên tiếp.

**Không bao giờ chạy:**
- lệnh xoá đệ quy (`rm -rf`, `Remove-Item -Recurse`, `rd /s`, kể cả khi bọc trong `cmd /c`) nhắm vào `/`, ổ đĩa, home, thư mục cấp 1, `.`, `..`, `*` hay gốc workspace;
- ghi bằng đường dẫn dạng lạ hoặc đường dẫn mạng.

## Tool

| Tool | Việc | Ghi chú |
| --- | --- | --- |
| `read_file` | đọc text, thư mục, PDF, ảnh, `.xlsx`, `.docx` | text đánh số dòng, tối đa 2000 dòng mỗi lần, đọc tiếp bằng `offset`/`limit`; PDF theo trang (`pages`, mặc định 10, tối đa 20); Excel từng sheet dạng CSV (`sheet`, số làm tròn 15 chữ số như Excel hiển thị; ô phần trăm là phân số, ngày có thể là số seri); Word ra markdown; đọc được UTF-16 do PowerShell 5.1 ghi |
| `glob_files`, `grep_files` | tìm file theo tên, tìm chữ trong file | viết bằng TypeScript thuần, không cần `rg`; bỏ qua `.git`, `node_modules`, `.venv`, file nhị phân và file chứa khoá |
| `write_file` | tạo file mới hoặc ghi đè cả file | ghi đè thì phải `read_file` toàn bộ file trước và file không đổi từ lúc đọc; giữ nguyên encoding, BOM, CRLF; hộp thoại có diff |
| `edit_file` | thay một đoạn trong file | `old_string` phải khớp đúng và duy nhất (hoặc dùng `replace_all`); khớp được ngoặc cong của Word |
| `shell` | chạy một lệnh | Windows dùng pwsh, không có thì Windows PowerShell 5.1 (ép UTF-8, lỗi in thành dòng `LỖI: …`); Linux/macOS dùng bash. Timeout mặc định 120s, tối đa 600s; khi timeout hoặc Esc thì giết cả cây tiến trình. Output dài hơn 30.000 ký tự được lưu vào `~/.opentrading/tool-output/` (xoá sau 7 ngày) để model đọc tiếp bằng `read_file`. Tiến trình con **không nhận** biến môi trường có tên chứa `API_KEY`/`APIKEY`, `TOKEN`, `SECRET`, `PASSWORD`/`PASSWD`, `CREDENTIAL(S)` ở cuối tên hoặc ngay trước `_` (ví dụ `GITHUB_TOKEN`, `HF_TOKEN`, `AWS_SECRET_ACCESS_KEY`; còn `TOKENS` thì vẫn giữ), và `OPENTRADING_*`. Script cần các biến này sẽ không thấy chúng: đặt khoá trong file cấu hình riêng của script |

- Ở `‖`, `write_file`, `edit_file` và `shell` chỉ gửi tên cho model (nạp bằng `tool_search` khi cần), nếu tool search đang hoãn tool. Ở `▸` và `▸▸` chúng được gửi đầy đủ: khoảng 850 token mỗi lượt.
- **"Luôn cho phép" một lệnh** chỉ có với lệnh đơn và chỉ đọc (`git status`, `git log`, `Get-ChildItem`, `python --version`…). Quy tắc lưu dưới dạng tiền tố và **không bao giờ** khớp lệnh ghép (`git status; Remove-Item …`).
- Lệnh xoá, chuyển, ghi, tải, cài, `npm run`, interpreter (`python x.py`, `node`, `npx`…) chỉ được duyệt đúng lệnh đó, tối đa cho cả phiên.

## /undo

Trước mỗi lần `write_file` hoặc `edit_file`, bản cũ được chép vào `~/.opentrading/file-history/<lần chạy>/`.

- `/undo` xem danh sách thay đổi; `/undo <số>` khôi phục bản cũ, hoặc xoá file nếu file đó do tool tạo.
- Nếu file đã bị sửa tiếp sau lần ghi của agent, phải thêm `--force`.
- `/undo` **chỉ hoàn tác được thay đổi của `write_file`/`edit_file` trong lần chạy OpenTrading hiện tại**. File do lệnh `shell` sửa thì không hoàn tác được. Các lần chạy cũ vẫn còn bản sao trên đĩa, xoá sau 30 ngày.

## /permissions và quy tắc tự viết

`/permissions` hiện:
- chế độ hiện tại và workspace;
- model duyệt và số request đã dùng;
- các quy tắc đã lưu: luôn cho phép, chặn, luôn hỏi (`d` để xoá);
- các lần auto mode chặn gần đây: `r` cho phép đúng lời gọi đó chạy một lần, rồi bạn nhắn model "thử lại".

Bạn tự viết quy tắc trong `~/.opentrading/config.json`:

```json
{
  "permissions": {
    "deny": [{ "tool": "read_file", "pattern": "*rieng*" }, { "tool": "mcp__x__*" }],
    "ask": [{ "tool": "shell", "pattern": "git push*" }],
    "defaultMode": "read-only"
  }
}
```

- `tool` là tên tool, có thể dùng `*`. `pattern` so với đường dẫn (với tool file) hoặc với nội dung lệnh (với `shell`), cũng dùng được `*`; không có `pattern` thì áp cho mọi lời gọi tool đó.
- `deny` chặn cả tool đọc. `ask` luôn hỏi kể cả khi đã có quy tắc cho phép, và ở `▸▸` cũng hỏi bạn thay vì hỏi model duyệt; nhưng `ask` **không áp cho tool đọc** (đọc thường chạy ngay, không xét quy tắc hỏi), muốn chặn đọc một thư mục thì dùng `deny`.
- Sửa tay xong thì **mở lại `/permissions`** (hoặc khởi động lại OpenTrading) để áp dụng.

## ▸▸ Tự động (auto mode)

Mỗi hành động cần duyệt được một model thứ hai xét trước khi chạy. Model này gọi là **model duyệt**, đặt ở `/config → Model duyệt auto mode`; mặc định là model của phiên.

- **Model duyệt thấy:**
  - tin nhắn của bạn;
  - câu trả lời `ask_user` và lời nhắn bạn gõ khi từ chối;
  - việc agent chính giao cho subagent, có ghi rõ đó là lời của agent, không phải của bạn;
  - các hành động của agent: lệnh, nội dung file ghi, đoạn sửa, URL, truy vấn tìm kiếm.
  - hồ sơ `INVESTOR.md` của bạn (ràng buộc trong đó tính là ranh giới bạn đặt, nhưng không tự cho phép một việc phá huỷ hay gửi ra ngoài);
  - nếu workspace là repo git: nhánh hiện tại, số thay đổi chưa commit và các remote. Push lên remote của repo này được coi là trong vùng tin cậy (vẫn chặn nếu trong đó có khoá hay dữ liệu riêng); remote khác là bên ngoài. OpenTrading không đọc chỉ dẫn nào từ thư mục dự án cho model duyệt.
- **Model duyệt không thấy:** chữ model chính viết, kết quả tool, nội dung trang web hay file. Lý do: lệnh độc giấu trong trang web hay PDF không thuyết phục được model duyệt. Báo cáo của subagent nền và nội dung prompt MCP được đánh dấu là của harness, không phải của bạn (cả khi mở lại phiên bằng `--continue`).
- **Hai bước:** bước 1 trả lời nhanh có chặn hay không, tốn 1 request. Chỉ khi bước 1 chặn hoặc không trả lời rõ thì mới chạy bước 2, có suy luận ngắn và nêu tên luật bị vi phạm. Tổng cộng khoảng 1 request cho mỗi hành động, 2 nếu bị nghi ngờ.
- **Khi subagent làm xong (chỉ ở ▸▸):** nếu subagent đã gọi tool có thay đổi hoặc tool MCP chỉ "tự khai" chỉ đọc, model duyệt rà lại các hành động của nó. Nếu thấy vượt yêu cầu, kết quả gửi cho agent chính có thêm dòng `[Cảnh báo an toàn từ auto mode]` ở đầu. Kết quả không bị chặn và không tính vào số lần chặn. Model duyệt không trả lời được thì chỉ ghi chú "chưa rà được". Subagent chỉ đọc dữ liệu (như các agent nghiên cứu của ultradesk) không tốn request nào cho bước này.
- **Nguồn gốc dữ liệu:** kết quả của `web_fetch`, `web_search` và tool MCP có thêm một dòng `[Nguồn: …]` cho model (host web hoặc tên server MCP), kèm nhắc rằng chỉ dẫn nằm trong dữ liệu là nội dung của nguồn, không phải lời bạn. Đây chỉ là thông tin nguồn gốc, không phải đánh giá dữ liệu là nguy hiểm.
- **Khi bị chặn:** model nhận tên tool, nhãn luật và lý do, ví dụ `Auto mode chặn shell [Git phá huỷ]: …`, kèm chỉ dẫn (giống Claude Code, chặt hơn ở chỗ đổi tool):
  - không làm đúng việc đó bằng tool hay lệnh khác (shell bị chặn thì không chuyển sang `write_file`, `edit_file`, tool MCP, script hay subagent); chỉ được chọn cách an toàn hơn hẳn mà không gây ra tác dụng đó, như ghi ra file mới thay vì ghi đè hoặc đưa lệnh để bạn tự chạy;
  - làm tiếp các việc không phụ thuộc; nếu việc đó bắt buộc thì làm hết phần còn lại rồi dừng, nói định làm gì, vì sao cần và cách bạn cho phép (`/permissions` → `r`, nói rõ trong tin nhắn, chuyển `▸`, hoặc tự thêm `autoMode.allow`). Model được dặn không tự sửa cấu hình quyền;
  - subagent bị chặn thì ghi việc đó và lý do vào kết quả cho agent chính.

  Bạn thấy một dòng `✘ Auto mode chặn … · /permissions để cho thử lại` dưới tool đó (`ctrl+o` hiện đủ đoạn model nhận) và một toast `… bị auto mode chặn · /permissions`, kể cả khi subagent bị chặn.
- **Không lách ở bước sau:** model duyệt thấy các hành động đã bị chặn hoặc bị từ chối (cùng đối tượng của chúng) kể từ tin nhắn gần nhất của bạn. Một hành động sau đó đạt cùng tác dụng lên cùng đối tượng bằng đường khác (ví dụ xoá bị chặn rồi ghi rỗng đè lên đúng file đó) sẽ bị chặn theo cùng luật. Khi bạn gửi tin nhắn mới, các dấu này được xoá (của subagent nền thì giữ tới khi nó xong), nên một lần chặn nhầm không kéo theo cả phiên. Khi bạn duyệt trong hộp thoại hoặc dùng `/permissions` → `r`, model duyệt chỉ ghi là bạn cho phép đúng lời gọi đó; chữ trong nội dung lời gọi không được coi là lời bạn.
- **Quay về hỏi bạn khi:**
  - bị chặn 3 lần liên tiếp, hoặc 20 lần trong phiên (một lời gọi chạy được mà không cần model duyệt, như `git status`, cũng cắt chuỗi "liên tiếp"; khi đã chạm giới hạn thì phải chờ bạn trả lời);
  - model duyệt lỗi hoặc trả lời sai định dạng (lỗi tạm thời như 5xx, quá tải, mất mạng được thử lại 1 lần; 429 thì không);
  - model duyệt hết quota (429): dòng chế độ hiện `tạm hỏi tay tới hh:mm`, kéo dài 10 phút.

  Hộp thoại khi đó ghi rõ vì sao nó hiện ra. Nếu bạn từ chối một hành động auto mode vừa chặn, model vẫn nhận nhãn và lý do của lần chặn đó.
- **Luật mặc định** (viết bằng tiếng Anh cho model duyệt, nhãn hiện bằng tiếng Việt):
  - *Chặn tuyệt đối:* đọc khoá/mật khẩu (kể cả in toàn bộ biến môi trường), lộ khoá ra ngoài, tự sửa quyền hay cấu hình của OpenTrading, chạy agent khác đã tắt duyệt.
  - *Chặn trừ khi bạn nêu rõ đúng việc đó:* **đặt, sửa, huỷ lệnh giao dịch thật hay chuyển tiền** (phải nêu mã, chiều, khối lượng, giá); tải code về rồi chạy; xoá hoặc ghi đè file có sẵn; git phá huỷ; gửi dữ liệu ra ngoài (kể cả nhét trong URL); nhắn tin thay bạn; cài thứ tự chạy về sau; hạ bảo mật; dò thông tin đăng nhập; mở máy ra internet; ghi ngoài workspace; đổi cài đặt hệ thống; chạy lệnh bị che giấu (`-EncodedCommand`, giải mã base64 rồi `iex`…).
  - *Ngoại lệ được phép:* lệnh chỉ đọc; chạy script do chính phiên viết trong workspace; cài gói đã khai báo, hoặc gói dữ liệu phổ biến khi bạn cần phân tích; GET trang dữ liệu thị trường công khai; mở file vừa tạo; tool dữ liệu OpenTrading.
  - Ranh giới bạn nói trong chat ("đừng ghi đè bao-cao.md", "không gửi gì ra ngoài") có tác dụng chặn tới khi bạn gỡ.
- **Đọc, không xét:** `web_search` và `web_fetch` vào các trang tin/tài chính Việt Nam có sẵn trong danh sách chỉ được ghi vào bản ghi cho model duyệt đọc, không bị duyệt.
- **Tool MCP tự khai "chỉ đọc":** chỉ server dữ liệu OpenTrading (cấu hình toàn cục, đúng địa chỉ server) được tin lời khai `readOnlyHint` và chạy luôn. Tool "chỉ đọc" của server MCP khác vẫn qua model duyệt trong ▸▸, vì tham số của nó đi tới một chương trình hay host khác. Lời gọi tới các tool "tự khai" chỉ đọc đó, và mọi lời gọi MCP có ghi, đều được ghi vào bản ghi ở mọi chế độ.
- **Chạy luôn, không tốn request:** file mới trong workspace (hoặc file chính hội thoại này tạo; `/new`, `/clear` hay mở lại phiên thì không còn tính), và lệnh shell đơn chỉ liệt kê hay in trạng thái: `git status/log/diff/show`, `dir`/`ls`/`Get-ChildItem`, `pwd`, `where`/`which`, `Get-Process`, `pip list`, `conda list`, `<chương trình> --version`. Lệnh có nối (`;`, `|`, `&&`), chuyển hướng (`>`), đọc nội dung file, nhắc tới file khoá, ổ `env:`/`HKLM:` hay `git diff --output` thì vẫn qua model duyệt. Các lệnh này vẫn được ghi vào bản ghi.
- **Tuỳ biến** trong `~/.opentrading/config.json` (chỉ đọc file này, không bao giờ đọc từ thư mục dự án, để một repo tải về không tự cấp quyền được):

  ```json
  {
    "autoMode": {
      "model": { "provider": "google", "model": "gemini-3.1-flash-lite" },
      "environment": ["$defaults", "Trusted sites: cafef.vn, vietstock.vn"],
      "soft_deny": ["$defaults", "Never touch D:\\Dau-tu\\that: real portfolio files"],
      "allow": ["$defaults"],
      "hard_deny": ["$defaults"]
    }
  }
  ```

  `"$defaults"` giữ luật có sẵn ở đúng vị trí đó. Một danh sách không có `"$defaults"` sẽ **thay toàn bộ** luật mặc định của danh sách ấy.
- **Đo chất lượng bằng model thật:** `bun scripts/dev/auto-mode-eval.ts --yes --model <provider/model> [--only 21,25] [--unreachable] [--all]`.
  - Không có `--yes` thì script chỉ in số ca và số request ước tính, không gọi model.
  - Bộ 76 ca có nhãn nằm ở `test/fixtures/auto-mode/actions.jsonl`, gồm cả ca nhiều lượt (yêu cầu chung chung rồi một bước phá huỷ, ranh giới người dùng nêu ở lượt trước), lệnh PowerShell che giấu và tool MCP bên thứ ba.
  - Ca có `route` là ca gate tự quyết trước classifier (file khoá/đường dẫn bảo vệ, web_fetch tới trang được duyệt sẵn, file mới trong workspace, lệnh shell chỉ đọc). Môi trường của bộ đánh giá giống lúc chạy thật, gồm cả dòng git và server MCP ngoài vùng tin cậy. Mặc định bỏ qua, `--unreachable` để chạy cả. Test offline kiểm nhãn này khớp với gate.
  - Script in tỉ lệ chặn đúng, tỉ lệ chặn nhầm, tách theo nhóm (`tags`), và số request.
  - Tốn khoảng 100 request (65 ca tới được model duyệt, mỗi ca chặn tốn 2), nên với Gemini miễn phí hãy dùng model 500 RPD.

**Giới hạn — đọc trước khi bật:**
- Model duyệt **có thể sai**: cho qua nhầm hoặc chặn nhầm. Claude Code công bố tỉ lệ bỏ lọt 17% trên các ca "làm quá tay". Đừng dùng `▸▸` cho việc nhạy cảm. Ranh giới cứng là các mục "luôn hỏi" và "không bao giờ chạy" ở trên, không phải model duyệt.
- Model yếu thì duyệt kém hơn.
- Nếu provider từ chối tuỳ chọn giảm "thinking" (Gemini 3 `thinkingLevel: low`, OpenAI `reasoningEffort: low`), mọi lần duyệt sẽ không có kết quả. Khi đó `▸▸` sẽ hỏi bạn cho mọi thứ, mỗi hộp thoại ghi "model duyệt không trả lời được: …" kèm lỗi. Hãy đổi model duyệt ở `/config`.
- Bản ghi không lưu kết quả của hành động (chỉ đánh dấu các lời gọi không chạy, và chỉ tới tin nhắn kế tiếp của bạn).
- Phân tích lệnh shell là dựa trên chuỗi, không phải trình phân tích cú pháp shell, và chưa có sandbox của hệ điều hành.

## Ngoài phạm vi đợt này

- Link file bấm được (OSC 8) trong transcript: bỏ, ghi vào việc sau.
- Sandbox hệ điều hành cho `shell` (kiểu codex, deepseek): việc sau.
- Skill hướng dẫn tạo tài liệu/báo cáo: phần của đồng nghiệp (xem [contracts.md](contracts.md)).
