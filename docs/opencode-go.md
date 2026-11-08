# OpenCode Go / Zen

OT gọi được OpenCode Go (gói tháng) và OpenCode Zen (trả theo request) qua provider `opencode-go` và `opencode` trong `/connect`. Key đặt trong biến `OPENCODE_API_KEY`. Model DeepSeek V4.1 Flash có id `deepseek-v4.1-flash`.

## Header OT gửi

Tài liệu Go ([opencode.ai/docs/go](https://opencode.ai/docs/go/), mục "Where can I use it?") yêu cầu client:
- tự nhận diện bằng User-Agent của chính mình, không dùng tên SDK;
- gửi "a stable session ID in `x-opencode-session` for each conversation" để Go định tuyến và cache prompt.

Client nào chỉ gửi header này ở một số đường gọi sẽ bị liệt vào nhóm "problematic".

Mọi request tới host `opencode.ai` đều được gắn header, bất kể SDK hay nơi gọi:

| Request | `User-Agent` | `x-opencode-session` |
|---|---|---|
| Agent chính, nén context | `opentrading/<phiên bản> (<hđh> <kiến trúc>)` | id phiên OT, ví dụ `20261108-101500-ab12` |
| Subagent | như trên | `<id phiên>/<id subagent>`, giữ nguyên qua các lần tiếp tục |
| Tiêu đề, model phụ web, model duyệt ▸▸ | như trên | id phiên chính |
| `ot -p` | như trên | id phiên của lệnh đó |
| Eval (`scripts/eval/run.ts`) | như trên | mỗi câu một id: `eval-<lần chạy>-<câu>#<lần lặp>` |

Id đổi khi bạn `/new`, `/clear` hoặc mở lại một phiên khác. Provider khác không nhận hai header này.

## Lưu ý khi benchmark

- Đừng đặt `subagents.model` thành `"auto"`. Với `opencode-go`, chế độ auto ưu tiên `claude-haiku-5-5` cho subagent, nên model không còn cố định. Khi không đặt `subagents.model`, subagent dùng model của phiên. Home tạm của eval không đặt giá trị này.
- Theo tài liệu Go, DeepSeek V4.1 Flash cần bật vùng **Global** trong Settings → Privacy của workspace.
