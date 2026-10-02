# Long.md — Việc tiếp theo cho nhánh mcp-server (tạo 02/10/2026)

## Trạng thái hiện tại

- Nhánh `mcp-server` @ 5c076fe (chưa commit): MCP client dual-transport (http + stdio),
  preset + `switch_preset` qua hộp phê duyệt, 27+3 skills theo
  `MCP-server/docs/skills-design-for-harness.md`, MCP prompts → slash commands,
  doom-loop guard, budget 20 calls/lượt, cap 5 tool đọc song song, maxOutputChars 12k,
  **onboarding first-run `/mcp-setup`** (tự tạo mcp.json + lưu token secret).
- Test: 99/100 pass (1 fail cũ từ main — bug date ở `test/session.test.ts`).

---

# HƯỚNG DẪN KẾT NỐI CHO TEAM (đã hoàn thành trên nhánh mcp-server)

## Cách 1 — Có token (khuyên dùng, 4 bước)

```bash
# 1. Lấy code
git fetch origin && git checkout mcp-server && bun install

# 2. Xin TEAM_TOKEN từ admin (kênh nội bộ) — KHÔNG commit token

# 3. Chạy
bun run dev

# 4. Lần đầu OpenTrading TỰ hỏi:
#    "Kết nối MCP-server công ty?" → dán TEAM_TOKEN → enter
#    (tự tạo ~/.opentrading/mcp.json preset scan + lưu token vào
#     ~/.opentrading/auth.json chmod 600 — không file nào trong repo)
```

## Cách 2 — Quen tay thủ công

```bash
cp .mcp.json.example .mcp.json        # template commit sẵn trong repo
# tạo .env (Bun tự đọc):  OPENTRADING_MCP_TOKEN=<TEAM_TOKEN>
bun run dev   # → /mcp → enter cho phép project config lần đầu
```

## Bước cá nhân duy nhất còn lại sau onboarding

- `/connect` → nhập key LLM riêng (Groq / Alibaba / NVIDIA / 200+ provider)
  → `/model` chọn model. Key lưu `~/.opentrading/auth.json`, ngoài repo.

## Sau khi xong — kiểm tra 1 phút

| Việc | Kỳ vọng |
|---|---|
| `/mcp` | `● opentrading · Preset scan (47 tool model thấy / 136 server có)` |
| `/tools` | nhóm theo preset, tag `presets`, ◇ = chỉ đọc |
| `/ticker_analysis VCB` | verdict 6 mục có số + `[nguồn · as_of giờ VN]` |
| Hỏi "giá VCB hôm nay" | số thật, có provenance; thiếu → nói thiếu, không bịa |

## Xử lý sự cố nhanh

| Triệu chứng | Cách xử lý |
|---|---|
| `Thiếu biến môi trường: OPENTRADING_MCP_TOKEN` | chạy `/mcp-setup` dán lại token, hoặc thêm entry `_env_OPENTRADING_MCP_TOKEN` vào `~/.opentrading/auth.json` |
| 401 khi gọi tool | token sai/hết hạn — xin admin cấp lại, `/mcp-setup` dán token mới (xoay tháng) |
| 429 | vượt 120 req/phút — chờ `Retry-After`, giảm tần suất |
| Cold start 20-40s | Render free-tier ngủ — chờ hoặc gọi `/healthz` trước |
| Model lỗi 404/413/429 | model EOL/quota — `/model` chọn khác; Groq free-tier TPM 8k yếu với preset lớn |
| `? opentrading — chờ cho phép` | project `.mcp.json` → `/mcp` → enter cho phép một lần |

## Vai trò admin (người giữ server)

- Token: tạo `secrets.token_urlsafe(32)`, gán `MCP_BEARER_TEAM` lên Render env
  (srv-dapvgk942hec73eb3khg → Environment), xoay mỗi tháng.
- Render free-tier: server `--preset all` (136 tools); preset lọc nằm ở harness —
  đổi preset không cần redeploy.

---

## Việc 1 — Commit + PR

- Fix bug date `test/session.test.ts` trước (`src/core/session/store.ts`: kỳ vọng
  folder `2026/09` nhưng now() thật là tháng 10 — test dùng ngày cố định phải
  inject clock).
- `git add` nhóm: (a) preset + switch_preset + approvals, (b) prompts slash +
  guards (doom-loop/budget/RwLock cap), (c) 27 skills + schema `tool_budget`.
- Push `origin mcp-server` → tạo PR lên main.

## Việc 2 — Compaction chống tràn context (gap lớn nhất vs opencode)

- opencode: context lớn → fork summary + `compaction.prune`
  (packages/opencode/src/session/prompt.ts:1139/1338).
- OpenTrading đã spec ở `handbook/contracts/runtime-policies.md` §Context and
  recovery: tạo event `context.summary.created`, giữ source sequences.
- Thiết kế gợi ý: `estimateTokens` mỗi turn (đã có `prompt/budget.ts`); khi vượt
  ngưỡng theo tier → tóm lược các lượt cũ thành 1 assistant-summary (giữ tool
  results dùng làm trích dẫn), history thay bằng `[summary]`, ghi
  `compactedFrom` vào session JSONL, compaction KHÔNG được xoá provenance.

## Việc 3 — Persist "always" của approvals

- Hiện tại: cache RAM theo process, mất khi restart (`src/core/approvals.ts`).
- Làm: lưu `~/.opentrading/approvals.json` (chmod 600 qua `store.writeJson
  secret=true`), key `kind:detail`; chỉ persist kind `preset-switch` —
  doom-loop vẫn hỏi mỗi lần (an toàn hơn).

## Việc 4 — MCP resources (nếu cần)

- Server có 4 resources: `opentrading://catalog/tools`, `reference/term-types`,
  `reference/exchanges`, `reference/gics`.
- opencode expose 3 tool `list_mcp_resources` / `list_mcp_resource_templates` /
  `read_mcp_resource` (packages/opencode/src/session/tools.ts:136-386).
- OpenTrading: thêm 1 tool builtin `read_resource(uri)` → `client.readResource`
  (~40 dòng + test); gate `requires_tools` không cần.

## Việc 5 — Subagent (Task tool — xa hơn, chưa gấp)

- opencode: agent phụ có prompt/permission/tools riêng, chạy nested session
  (`tool/task`, `describeTask` registry.ts:265-278).
- Chỉ làm khi có use case thật (vd chạy backtest dài trong nền).

## Việc 6 — Chi tiết nhỏ

- SSE transport fallback cho server legacy (opencode `mcp/index.ts:277-284`).
- Retry tool-call với tên viết thường khi provider bắt case-sensitivity
  (opencode `session/llm.ts:297-307`).
- Đưa `TURN_TOOL_BUDGET` (20) + `MAX_PARALLEL_READERS` (5) vào config.json
  (hiện là hằng số).
- OAuth MCP — chờ server bật OAuth endpoints (hiện `oauth:false` là đúng spec).
- `/doctor`: kiểm tra key + model còn sống (catalog EOL nhanh — llama-3.3, NIM
  410 hàng loạt từng gặp).

## Nợ kỹ thuật đã biết

- `test/tui.test.tsx` `/tools` expect `Tools · 7` — thêm tool builtin nào phải
  cập nhật lại con số.
- Catalog 30 skill ≈ 1,3k token (bị shrink ở tier thấp) — cân nhắc nhóm skill
  theo tag thay vì list phẳng nếu thêm skill nữa.
- `fillPromptArgs` hỗ trợ `name=value` + positional — prompt >3 tham số nên
  hiện gợi ý cú pháp trong description.
- Render free-tier sleep 20-40s — cân nhắc warm-up `/healthz` trước `tools/list`.
