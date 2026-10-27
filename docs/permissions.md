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
- **Model duyệt không thấy:** chữ model chính viết, kết quả tool, nội dung trang web hay file. Lý do: lệnh độc giấu trong trang web hay PDF không thuyết phục được model duyệt. Báo cáo của subagent nền và nội dung prompt MCP được đánh dấu là của harness, không phải của bạn.
- **Hai bước:** bước 1 trả lời nhanh có chặn hay không, tốn 1 request. Chỉ khi bước 1 chặn hoặc không trả lời rõ thì mới chạy bước 2, có suy luận ngắn và nêu tên luật bị vi phạm. Tổng cộng khoảng 1 request cho mỗi hành động, 2 nếu bị nghi ngờ.
- **Khi bị chặn:** model chính nhận lý do và nhãn luật, ví dụ `[Gửi dữ liệu ra ngoài]`, rồi làm cách khác hoặc dừng lại giải thích.
- **Quay về hỏi bạn khi:**
  - bị chặn 3 lần liên tiếp, hoặc 20 lần trong phiên;
  - model duyệt lỗi hoặc trả lời sai định dạng;
  - model duyệt hết quota (429): dòng chế độ hiện `tạm hỏi tay tới hh:mm`, kéo dài 10 phút.

  Hộp thoại khi đó ghi rõ vì sao nó hiện ra.
- **Luật mặc định** (viết bằng tiếng Anh cho model duyệt, nhãn hiện bằng tiếng Việt):
  - *Chặn tuyệt đối:* đọc khoá/mật khẩu (kể cả in toàn bộ biến môi trường), lộ khoá ra ngoài, tự sửa quyền hay cấu hình của OpenTrading, chạy agent khác đã tắt duyệt.
  - *Chặn trừ khi bạn nêu rõ đúng việc đó:* **đặt, sửa, huỷ lệnh giao dịch thật hay chuyển tiền** (phải nêu mã, chiều, khối lượng, giá); tải code về rồi chạy; xoá hoặc ghi đè file có sẵn; git phá huỷ; gửi dữ liệu ra ngoài (kể cả nhét trong URL); nhắn tin thay bạn; cài thứ tự chạy về sau; hạ bảo mật; dò thông tin đăng nhập; mở máy ra internet; ghi ngoài workspace; đổi cài đặt hệ thống.
  - *Ngoại lệ được phép:* lệnh chỉ đọc; chạy script do chính phiên viết trong workspace; cài gói đã khai báo, hoặc gói dữ liệu phổ biến khi bạn cần phân tích; GET trang dữ liệu thị trường công khai; mở file vừa tạo; tool dữ liệu OpenTrading.
  - Ranh giới bạn nói trong chat ("đừng ghi đè bao-cao.md", "không gửi gì ra ngoài") có tác dụng chặn tới khi bạn gỡ.
- **Đọc, không xét:** `web_search` và `web_fetch` vào các trang tin/tài chính Việt Nam có sẵn trong danh sách chỉ được ghi vào bản ghi cho model duyệt đọc, không bị duyệt.
- **Chạy luôn, không tốn request:** file mới trong workspace (hoặc file chính phiên tạo), và lệnh shell đơn chỉ liệt kê hay in trạng thái: `git status/log/diff/show`, `dir`/`ls`/`Get-ChildItem`, `pwd`, `where`/`which`, `Get-Process`, `pip list`, `conda list`, `<chương trình> --version`. Lệnh có nối (`;`, `|`, `&&`), chuyển hướng (`>`), đọc nội dung file, nhắc tới file khoá, ổ `env:`/`HKLM:` hay `git diff --output` thì vẫn qua model duyệt. Các lệnh này vẫn được ghi vào bản ghi.
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
  - Ca có `route` là ca gate tự quyết trước classifier (file khoá/đường dẫn bảo vệ, web_fetch tới trang được duyệt sẵn, file mới trong workspace). Mặc định bỏ qua, `--unreachable` để chạy cả. Test offline kiểm nhãn này khớp với gate.
  - Script in tỉ lệ chặn đúng, tỉ lệ chặn nhầm, tách theo nhóm (`tags`), và số request.
  - Tốn khoảng 90 request, nên với Gemini miễn phí hãy dùng model 500 RPD.

**Giới hạn — đọc trước khi bật:**
- Model duyệt **có thể sai**: cho qua nhầm hoặc chặn nhầm. Claude Code công bố tỉ lệ bỏ lọt 17% trên các ca "làm quá tay". Đừng dùng `▸▸` cho việc nhạy cảm. Ranh giới cứng là các mục "luôn hỏi" và "không bao giờ chạy" ở trên, không phải model duyệt.
- Model yếu thì duyệt kém hơn.
- Nếu provider từ chối tuỳ chọn giảm "thinking" (Gemini 3 `thinkingLevel: low`, OpenAI `reasoningEffort: low`), mọi lần duyệt sẽ không có kết quả. Khi đó `▸▸` sẽ hỏi bạn cho mọi thứ, mỗi hộp thoại ghi "model duyệt không trả lời được: …" kèm lỗi. Hãy đổi model duyệt ở `/config`.
- Bản ghi không lưu kết quả của hành động: một lời gọi bạn đã từ chối trông vẫn giống việc agent đã làm.
- Phân tích lệnh shell là dựa trên chuỗi, không phải trình phân tích cú pháp shell, và chưa có sandbox của hệ điều hành.

## Ngoài phạm vi đợt này

- Link file bấm được (OSC 8) trong transcript: bỏ, ghi vào việc sau.
- Sandbox hệ điều hành cho `shell` (kiểu codex, deepseek): việc sau.
- Skill hướng dẫn tạo tài liệu/báo cáo: phần của đồng nghiệp (xem [contracts.md](contracts.md)).
