# Bộ skill ngành Việt Nam (design)

Ngày: 2026-10-20 · Nhánh: `feat/skills-nganh-vn` · Cơ sở: `dc209f8` (v1.7.0 của
`dinh-vi-chu-ky-vn`, tip PR103)

## Mục tiêu

13 skill phân tích ngành **độc lập hoàn toàn**: chỉ chạy khi người dùng hỏi đúng
ngành đó, chỉ làm framework phân tích ngành (driver + KPI + định giá + rủi ro).
Chu kỳ, luân chuyển ngành, pha thị trường **tuyệt đối chỉ thuộc**
`dinh-vi-chu-ky-vn` — skill ngành cấm xác định pha.

Động lực: skill tổng quát (`co-ban-chuyen-sau`, `dinh-gia-chuyen-sau`,
`phan-tich-chuyen-sau-1-ma`) đọc chung một bộ chỉ tiêu cho mọi ngành, nên mô hình
không biết với ngân hàng phải đọc NIM/CASA/Nhóm 2 thay vì lãi gộp, với thép phải
đọc spread quặng–than, với điện phải đọc cải cách giá bán lẻ trước nhu cầu.

## Kiến trúc

```
dinh-vi-chu-ky-vn        ← CHỈ pha thị trường + luân chuyển (giữ nguyên nhiệm vụ)
    │
    └── cross-link 1 chiều ──→ <ngành>-vn × 13 (độc lập hoàn toàn)
                                   CHỈ framework ngành
                                   CẤM: pha, rotation, chuỗi, mùa vụ thị trường
```

## Các skill

| Skill | `requires_tools` | Driver cốt lõi |
|---|---|---|
| `ngan-hang-vn` | `financial_detail`, `vs_financial_norms` | hạn mức tín dụng · spread NIM · CASA · NPL/Nhóm 2/LLCR · ngoại bảng · Circular 50/2026 |
| `chung-khoan-vn` | `financial_detail`, `vs_financial_norms` | dư nợ margin · spread margin · dịch phí→balance-sheet · cơ chế KRX/CCP/nâng hạng |
| `bat-dong-san-vn` | `financial_detail`, `planned_targets` | tín dụng BĐS · kênh trái phiếu + tường đáo hạn · Nghị định 96/2024 · phân khúc nhà ở vs KCN |
| `thep-vn` | `financial_detail`, `yf_commodities` | spread giá bán − (quặng + than cốc) · phòng vệ thương mại · cơ cấu HRC vs xây dựng |
| `dau-khi-vn` | `yf_commodities`, `financial_detail` | Brent · tuyến đường/tonne-mile · thay thế trữ lượng · E&P vs lọc dầu |
| `dien-luc-vn` | `financial_detail`, `yf_commodities` | cải cách giá bán lẻ (biến then chốt) · cơ cấu nguồn · thủy văn · PDP8 · tải trọng mới |
| `van-tai-vn` | `financial_detail`, `vs_xnk_detail` | cước vận tải · xuất khẩu · tuyến · công suất cảng · bunker · tỷ lệ khóa giá |
| `hoa-chat-vn` | `financial_detail`, `yf_commodities` | chu kỳ giá ure · chính sách xuất khẩu Trung Quốc · tỷ lệ xuất khẩu · chi phí khí |
| `tieu-dung-ban-le-vn` | `financial_detail`, `vs_indicator_data` | bán lẻ THỰC · thu nhập hộ gia đình · VAT · độ thâm nhập hiện đại · premiumisation |
| `cong-nghe-vn` | `financial_detail`, `planned_targets` | IT services nước ngoài · signed/backlog · AI trong nước · nhân lực |
| `bao-hiem-vn` | `financial_detail`, `vs_financial_norms` | NB premium · persistency · underwriting vs thu nhập tài chính · cơ cấu kênh |
| `vingroup-vn` | `financial_detail`, `company_events` | Vinhomes presale · VinFast lỗ/tái cơ cấu · tái cấu trúc nợ · tỷ trọng chỉ số · giao dịch liên kết |
| `xuat-nhap-khau-vn` | `vs_xnk_detail`, `vs_indicator_data` | thuế 2 lớp (IEEPA + Section 301) · chu kỳ công nghệ · FDI · nhập khẩu máy móc dẫn dắt · CBAM |

## Bộ khung chung — 12 heading giống nhau ở mọi skill

1. `# <Ngành> Việt Nam — framework phân tích`
2. `## Khi nào dùng` (+ 5 dòng "khi KHÔNG dùng" cố định cross-link)
3. `## Trụ cột driver` — bảng: Driver | Kênh truyền dẫn | Đo/xác minh bằng
4. `## Các bước` — 4–5 bước, gom song song mỗi lượt, ghi tên tool
5. `## Cây quyết định <câu hỏi cốt lõi>` — Q0→Qn, **DỪNG ở ★ đầu tiên**
6. `## Chỉ báo đặc thù ngành` — trỏ `references/kpi.md`
7. `## Định giá theo đặc thù ngành`
8. `## Rủi ro đặc thù`
9. `## Ranh giới` — cấm xác định pha → `dinh-vi-chu-ky-vn`
10. `## Giới hạn`
11. `## Ví dụ`
12. `## Trực quan hóa` + `## File tham chiếu`

## Nguyên tắc áp dụng (bài học PR103)

1. **Một luật một chỗ** — ngưỡng/định nghĩa nằm đúng một file trong skill; SKILL.md
   trỏ tới, không chép lại.
2. **Không tự đặt ngưỡng mới khi đã có** — dùng lại bar sẵn có của nền tảng.
3. **Luật = điều kiện tra được**, không phải kết quả đã đo.
4. **Cơ chế, không kết quả** — mô tả *vì sao* driver tác động, không ghi số đã đo.
5. **Precondition rõ ràng** — thiếu tool bắt buộc thì báo thiếu, không kết luận.
6. **Provenance từng số** — mọi số kèm tên tool.

## Ràng buộc bắt buộc (đã xác minh trong repo)

- Catalog line (`description` + "Dùng khi: " + `when_to_use`) ≤ 250 ký tự.
- Trigger sau fold (bỏ dấu) không được ∈ `BANNED_TRIGGERS`; **từ ≤4 ký tự không có
  trong `SHORT_OK` bị chặn** → không dùng trigger "thép", "ure", "NIM", "CASA",
  "NPL", "HPG", "FPT", "cntt". Acronym để trong `description`; trigger dùng cụm ≥2
  từ.
- `references/` chỉ giữ luật + ngưỡng + cơ chế; rule `copiedResults` chặn 3 dạng
  kết quả đo ("so sánh nhất", "số mẫu", "kết quả gắn năm").
- Heading tiếng Việt (cấm `Steps`/`Workflow`/`Reference files`…).
- `uses_tools` chỉ tool đọc; không preload write tool (`*_refresh|finalize|create|…`).
- Mọi tool ghi trong skill phải tồn tại trong `test/fixtures/mcp-catalog/opentrading.json`.

## Testing

- `bun test test/skills.test.ts` — danh sách bundled (13 tên mới, thứ tự alphabet)
  + danh sách skill có hook `## Trực quan hóa`.
- `bun test test/skill-lint.test.ts` — `copiedResults`, trigger, catalog length,
  unknownTools, preloadedWrites, englishHeadings.
- `bun run typecheck` + full suite.
- `bun scripts/dev/routing-eval.ts` — 13 skill mới dịch chuyển routing; phải kiểm
  không cướp case của `dinh-vi-chu-ky-vn` / `phan-tich-chuyen-sau-1-ma`.
- **Test thực tế bằng LLM thật** (yêu cầu của chủ dự án): hỏi câu hỏi ngành thật,
  đối chiếu skill được chọn + chất lượng câu trả lời.

## Không làm

- Không sửa logic chu kỳ/luân chuyển của `dinh-vi-chu-ky-vn` (chỉ thêm cross-link).
- Không thêm tool MCP mới.
- Không ghi số liệu thị trường cụ thể (giá, P/E, hit-rate hiện tại) vào skill.
- Không đổi `prompts/`.

## Cập nhật sau review (2026-10-21)

Bản triển khai khác thiết kế trên ở các điểm sau (lý do trong review PR #116):

- Định tuyến: thêm `triggers.exclude`; 13 skill ngành loại câu hỏi pha/sóng, tin tức, so
  sánh, khuyến nghị mua bán; `dinh-vi-chu-ky-vn` thêm trigger `dẫn sóng`, `pha nào`,
  `chu kỳ ngành`. Bỏ trigger rộng (`nợ xấu`, `lãi suất cho vay`, `căn hộ`, `giá dầu brent`,
  `dòng vốn nước ngoài`, `thuế quan`, tên thương hiệu đơn lẻ).
- `requires_tools` chỉ giữ tool skill không thể thiếu; `yf_commodities` không có quặng sắt,
  than cốc, than nhiệt, ure nên các giá này tra bằng `web_search`.
- `news_market` không tra theo chủ đề: số ngành và văn bản tra bằng `web_search`.
  `peer_compare` chỉ trả snapshot định giá; chỉ báo vận hành của peer đọc bằng
  `financial_detail` từng mã. `vs_xnk_detail` chia theo nước, không theo nhóm hàng.
- Cây quyết định theo luật lint `decisionTrees` (docs/contracts.md §3).
- `bao-hiem-vn` tách phi nhân thọ (combined ratio, tái bảo hiểm) và nhân thọ;
  `dau-khi-vn` thêm mảng phân phối khí, xăng dầu; `van-tai-vn` thêm hàng không.
- `xuat-nhap-khau-vn`: thuế đối ứng của Mỹ khác nhau theo nước (không "đều cho mọi đối
  tác"); bỏ các tên văn bản/số hiệu cụ thể ở bảng trên — skill tra văn bản khi chạy.
- Ngân sách catalog: A 2.400, B 1.050 (test trong `test/skills.test.ts`).
