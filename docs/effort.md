# Effort suy luận

`effort` cho model biết nên suy nghĩ bao nhiêu trước khi trả lời. Tên mức giống Claude Code: `low`, `medium`, `high`, `xhigh`, `max`. Mức cao hơn thường cho câu trả lời kỹ hơn nhưng tốn token hơn và chậm hơn.

## Đặt ở đâu

| Chỗ | Áp dụng cho |
| --- | --- |
| `/config` → **Effort suy luận** (`"effort"` trong `config.json`) | Agent chính |
| `/config` → **Effort của subagent** (`"subagents": { "effort": … }`) | Subagent, khi loại agent không tự đặt |
| `effort:` trong frontmatter của `agents/*.md` | Loại agent đó |

Không đặt gì thì harness không gửi effort, và provider dùng mức mặc định của nó.

## Mỗi provider hiểu thế nào

| Provider / model | Trường gửi đi | Các mức nhận |
| --- | --- | --- |
| Gemini 3 Flash / Flash-Lite | `thinkingLevel` | low, medium, high |
| Gemini 3 Pro | `thinkingLevel` | low, high |
| Gemini 2.5 Flash / Flash-Lite | `thinkingBudget` (1024 / 4096 / 8192 / 16384 token) | low → xhigh |
| Gemini 2.5 Pro | `thinkingBudget` (tới 32768) | low → max |
| Claude Opus/Sonnet/Haiku 5.5, Fable | `effort` | low → max |
| Claude Opus 4.5–4.8, Sonnet 4.6, Opus/Sonnet 5 | `effort` | low, medium, high |
| OpenAI gpt-5.2 trở lên (endpoint chính thức) | `reasoningEffort` | low → xhigh |
| OpenAI gpt-5, o-series (endpoint chính thức) | `reasoningEffort` | low, medium, high |
| Groq gpt-oss | `reasoningEffort` | low, medium, high |

- Model không có mức được chọn thì dùng **mức thấp hơn gần nhất** mà nó có. Ví dụ, `xhigh` chạy là `high` trên Opus 4.6, và `medium` chạy là `low` trên Gemini 3 Pro.
- Với Claude, mức trên `high` chỉ dùng cho model luôn bật suy luận. Harness không bật `thinking`, và Anthropic từ chối `xhigh`/`max` khi suy luận đang tắt trên một số model (Claude Code cũng hạ về `high` cho Opus 5).
- Model không suy luận (models.dev ghi `reasoning: false`), Claude đời cũ và gateway bên thứ ba dùng `@ai-sdk/openai` thì không nhận effort; harness bỏ qua.
- Gemini gói miễn phí tính quota theo request, không theo token suy luận. Mức cao chỉ làm chậm hơn và tốn token-mỗi-phút (TPM) hơn.

Mã nguồn: `src/core/effort.ts`.
