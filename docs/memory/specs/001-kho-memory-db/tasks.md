# Việc cần làm 001: Kho memory và bảng chính sách theo loại

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md) · **Mô hình dữ liệu:** [data-model.md](data-model.md)

**Ký hiệu:**
- `[P]`: làm song song được;
- `[S1]`: thuộc story 1;
- `[LÕI]`: sửa file của chủ repo, chỉ làm sau khi người dùng xác nhận. **Spec này không có việc `[LÕI]`.**

Đánh dấu `[x]` chỉ khi việc đã xong **và** đã chạy kiểm thật.

Giai đoạn xếp theo năm lớp (ý kiến duyệt R53), khác thứ tự story của spec: lớp dưới là nền cho lớp trên. Mỗi lớp viết test trước, chạy thấy đỏ, rồi mới viết code. Ghi đỏ/xanh vào §5 `handoff.md` của spec.

Mọi test: thư mục tạm bằng `mkdtemp`; `afterEach` gọi `close()` cho mọi kho đã mở **rồi mới** xoá thư mục; đồng hồ cố định qua tuỳ chọn `now`.

## Giai đoạn 1: Chuẩn bị

- [x] T001 Kiểm môi trường: `bun.exe --version` = 1.4.2; `bun install --frozen-lockfile` nếu `node_modules` lệch; typecheck sạch; `bun test` xanh. Ghi số test làm mốc vào §5 handoff. Kiểm spec 004 đã commit ở máy (R52); chưa thì dừng và báo

## Giai đoạn 2: Lớp 1, mở kho, lược đồ, đóng kết nối (Story 1, P1)

**Mục tiêu:** kho tạo, mở, từ chối, đóng đúng; nền cho mọi lớp sau.
**Kiểm độc lập:** `test/memory-store-open.test.ts`.

- [x] T002 [S1] Viết test `test/memory-store-open.test.ts` (đỏ trước):
  - (a) thư mục chưa có kho → tạo bản 1 (`user_version` 1, `application_id` của kho); mở lần hai không chạy lại bước tạo (đếm số lần bước nâng chạy bằng `migrations` giả);
  - (b) kho `user_version = 2` (tạo bằng `bun:sqlite` trong test) → `newer_schema`, câu báo nêu bản 2 và bản app hiểu; byte file giống hệt; xoá thư mục ngay sau đó thành công;
  - (c) file văn bản → `not_a_store`, nêu đường dẫn; file giữ nguyên; xoá thư mục được;
  - (d) file SQLite có bảng nhưng `application_id` khác → `not_a_store`;
  - (e) bước nâng giả ném lỗi giữa chừng → không còn bảng nào của bước đó, `user_version` giữ nguyên; file do lần mở tạo thì bị xoá;
  - (f) kho bản 1 có ràng buộc "Không dùng margin" (ghi bằng SQL thẳng trong test, vì lớp 2 chưa có) → mở lại đọc được bằng truy vấn thẳng; không chạy lại bước tạo;
  - (g) trên hệ không phải Windows: file kho mới có quyền `0o600` (bỏ qua trên Windows);
  - (h) YC-029: kho bản 1 có thêm một cột lạ trong bảng ràng buộc (test tự thêm) → mở được; ca kiểm "giữ cột lạ khi sửa" thêm ở T009
- [x] T003 [P] Tạo `src/core/memory/store/errors.ts`: `MemoryStoreError` với các loại ở plan §5; hàm đổi `SQLiteError` (theo `code`) sang `MemoryStoreError` ở một chỗ; câu báo tiếng Việt
- [x] T004 [P] Tạo `src/core/memory/store/types.ts`: kiểu công khai theo plan §5
- [x] T005 Tạo `src/core/memory/store/schema.ts`: `SCHEMA_VERSION = 1`, `APPLICATION_ID`, bước "rỗng → 1" tạo mọi bảng và chỉ mục ở `data-model.md` §2 (kể cả chỉ mục duy nhất một phần của bí danh), dòng `counters('constraint_set', 0)`
- [x] T006 Tạo `src/core/memory/store/open.ts`: `openMemoryStore` theo plan §3.1 (tạo file `0o600`, `busy_timeout`, đọc trước khi ghi, WAL, nâng trong transaction có đọc lại `user_version`, `close(true)` ở mọi nhánh lỗi, xoá file do mình tạo khi lỗi); `close()` gọi được nhiều lần; `reader`, `writer`, `gate` tạm là object đông cứng rỗng, lớp sau thêm hàm
- [x] T007 Chạy T002 xanh; typecheck sạch

**Checkpoint lớp 1:** `memory-store-open` xanh; typecheck sạch; `bun test` toàn bộ xanh.

## Giai đoạn 3: Lớp 2, ràng buộc, cách trình bày, phiên bản bộ ràng buộc (Story 2, P1)

**Mục tiêu:** ghi có phiên bản, chống ghi đè, giới hạn, hai tiến trình.
**Kiểm độc lập:** `test/memory-store-constraints.test.ts`, `test/memory-store-concurrency.test.ts`.

- [x] T008 [P] [S2] Tạo `src/core/memory/limits.ts`: `MEMORY_LIMITS` theo plan §3.4 (mỗi dòng có `why`), `countChars` (NFC, `Intl.Segmenter` grapheme)
- [x] T009 [S2] Viết test `test/memory-store-constraints.test.ts` (đỏ trước), theo Story 2 kịch bản 1–4, 6:
  - lưu "Không dùng margin" → ID 1 bản 1, phạm vi `all_accounts`, nguồn `manual`, thời điểm bằng đồng hồ cố định;
  - sửa với mốc 1 → bản 2; đọc bản 1 vẫn văn bản cũ;
  - sửa với mốc cũ (2 khi đã có 3) → `conflict`, `current` là bản 3; kho chỉ có bản 3;
  - tổng 1.450 + 80 → `limit`, nêu tổng và giới hạn; kho không đổi; mỗi mục 201 ký tự → `limit`;
  - `constraintSet()` tăng sau thêm, sửa, xoá ràng buộc; không tăng khi thêm, sửa, xoá cách trình bày; cách trình bày tổng 1.000;
  - TC-002: tạo 3, xoá #3, tạo mới → ID 4;
  - TC-007 phần ràng buộc: sau xoá, `constraint`, `constraintVersion` trả "đã xoá", `constraints()` không còn; sửa hoặc xoá lại → `deleted`; xoá với mốc lệch → `conflict`;
  - YC-029: kho có cột lạ (như T002 h) → sửa ràng buộc, giá trị cột lạ của dòng đó giữ nguyên
- [x] T010 [S2] Tạo `src/core/memory/store/text.ts` (bước NFC, rỗng, giới hạn; chỗ cho bước khoá bí mật để lớp 5 thêm) và `src/core/memory/store/constraints.ts`; nối vào `reader`, `writer` trong `open.ts`. Mỗi ghi: kiểm văn bản → `transaction().immediate()` đọc mốc, so, ghi, tăng `constraint_set`
- [x] T011 [S2] Viết test `test/memory-store-concurrency.test.ts` và script `test/fixtures/scripts/memory-store-contender.ts` (đỏ trước):
  - TC-004: hai tiến trình phụ cùng sửa ràng buộc #1 từ bản 1 (bắt đầu cùng lúc bằng file tín hiệu): đúng một `ok`, một `conflict`; kho có đúng bản 2;
  - TC-005: tiến trình phụ giữ `BEGIN IMMEDIATE` 3 giây; tiến trình chính `addConstraint` → `busy` sau dưới 2.000 ms (đo); kho không có mục mới;
  - TC-011: hai kết nối A, B cùng file; B ghi → `A.changed()` true, gọi lại false; không ai ghi → false; A tự ghi → `A.changed()` true
- [x] T012 [S2] Thêm `changed()` vào `open.ts` theo plan §3.2; chạy T009, T011 xanh; chạy T011 ba lần liền đều xanh

**Checkpoint lớp 2:** hai file test xanh; typecheck sạch; `bun test` toàn bộ xanh.

## Giai đoạn 4: Lớp 3, chủ đề, bí danh, luận điểm (Story 3, P1)

**Mục tiêu:** ID nội bộ, bí danh có lịch sử, số bản không đánh lại.
**Kiểm độc lập:** `test/memory-store-theses.test.ts`.

- [x] T013 [S3] Viết test `test/memory-store-theses.test.ts` (đỏ trước), theo Story 3 kịch bản 1–7:
  - tạo ngành "Thép", mã "HPG" thuộc "Thép"; lưu luận điểm mốc `null` với hai điều kiện, hạn xem lại `2026-12-31` → bản 1, `watching`, điều kiện đúng thứ tự; lưu lại mốc `null` → `conflict`;
  - bản 3 → bản 4 với đồng hồ cố định: `validTo` bản 3 = `validFrom` bản 4; bản 3 đọc nguyên văn;
  - thêm bí danh "HPG2" → tra "hpg", "HPG2" ra cùng ID; lịch sử có ngày thêm; tên hiển thị là "HPG2"; `retireAlias` → tra "HPG" không ra, lịch sử có ngày thôi;
  - bí danh "HSG" đang thuộc chủ đề khác → `alias_taken` nêu chủ đề; sau khi chủ đề kia thôi dùng "HSG" thì thêm được;
  - xoá luận điểm (bản 1–3) rồi lưu mới mốc `null` → bản 4; `thesisVersion(…, 2)` "đã xoá"; trạng thái `none` sau xoá, `watching` sau lưu;
  - đổi trạng thái `refuted` mốc 4 → không tạo bản, có ngày đổi; mốc lệch → `conflict`;
  - 9 điều kiện, văn bản 351 ký tự, một điều kiện 161 ký tự → `limit` nêu trường; bản trước giữ nguyên; `sectorId` trỏ chủ đề không phải ngành → `invalid`;
  - TC-002 cho chủ đề: tạo 3 chủ đề, ID tăng; (chủ đề không xoá được ở bản đầu nên kiểm ID tăng đơn điệu)
- [x] T014 [S3] Tạo `src/core/memory/store/subjects.ts` (tạo chủ đề, bí danh, tra theo `alias_key`) và `src/core/memory/store/theses.ts` (lưu bản, đổi trạng thái, xoá, đọc bản); nối vào `reader`, `writer`
- [x] T015 [S3] Chạy T013 xanh

**Checkpoint lớp 3:** `memory-store-theses` xanh; typecheck sạch; `bun test` toàn bộ xanh.

## Giai đoạn 5: Lớp 4, bài học, quyết định (Story 4 P2, Story 5 P1)

**Mục tiêu:** bài học có bản; quyết định ghi nối gắn đúng căn cứ, căn cứ tuỳ chọn (R51).
**Kiểm độc lập:** `test/memory-store-lessons.test.ts`, `test/memory-store-decisions.test.ts`.

- [x] T016 [P] [S4] Viết test `test/memory-store-lessons.test.ts` (đỏ trước), theo Story 4 kịch bản 1–3: bài học #1 áp dụng cho ngành "Ngân hàng" với ngoại lệ, tag; sửa mốc 1 → bản 2, bản 1 nguyên văn; tiêu đề 121 → `limit`; "áp dụng cho" trỏ chủ đề không tồn tại → `not_found`; 11 tag → `limit`; TC-002 (xoá #3 → mới là #4); TC-007 phần bài học
- [x] T017 [P] [S5] Viết test `test/memory-store-decisions.test.ts` (đỏ trước), theo Story 5 kịch bản 1–7:
  - HPG bản 2, `constraintSet` 5 → D1 có căn cứ bản 2 và bộ ràng buộc 5;
  - lưu HPG bản 3 rồi ghi D2 căn cứ bản 2 → D2 giữ bản 2;
  - căn cứ bản 9 hoặc bản đã xoá hoặc bản của chủ đề khác → bị từ chối, không có dòng mới;
  - `writer` không có hàm sửa quyết định (`@ts-expect-error` và kiểm `Object.keys`);
  - lỗi giữa chừng: test mở kết nối SQL thẳng, tạo trigger `BEFORE INSERT ON decisions … RAISE(ABORT, …)` → `addDecision` ném `write_failed`, không có quyết định nào được lưu, `constraintSet` không đổi (không dùng `spyOn` trên export: không chặn được lời gọi nội bộ giữa các module);
  - xoá luận điểm HPG → D1 còn, căn cứ `{ version: 2, deleted: true }`; không có nội dung luận điểm trong D1;
  - R51: VNM không có luận điểm, D3 không căn cứ → `basis: "none"`, có `constraintSet`; chủ đề không tồn tại (ID 999) → `not_found`, không có dòng mới;
  - xoá D1 → "đã xoá"; xoá lại → `deleted`; TC-002 cho quyết định
- [x] T018 [S4] Tạo `src/core/memory/store/lessons.ts`; nối vào `reader`, `writer`
- [x] T019 [S5] Tạo `src/core/memory/store/decisions.ts`: một transaction kiểm chủ đề, căn cứ (nếu có), đọc `constraint_set`, ghi; nối vào `reader`, `writer`
- [x] T020 Chạy T016, T017 xanh

**Checkpoint lớp 4:** hai file test xanh; typecheck sạch; `bun test` toàn bộ xanh.

## Giai đoạn 6: Lớp 5, bảng chính sách, cổng đọc, khoá bí mật (Story 6, P1)

**Mục tiêu:** một bảng, một cổng, test duyệt bảng; chặn khoá bí mật; tách quyền.
**Kiểm độc lập:** `test/memory-policy.test.ts`, `test/memory-store-text.test.ts`.

- [x] T021 [P] [S6] Viết test `test/memory-policy.test.ts` (đỏ trước):
  - bảng kỳ vọng **viết riêng trong test** (không import `MEMORY_POLICY` để dựng kỳ vọng);
  - kho có một mục mỗi loại (ràng buộc "Không dùng margin", cách trình bày "Trả lời ngắn", luận điểm HPG bản 1 với HPG thuộc ngành "Thép", bài học #1 "Định giá ngân hàng", quyết định D1 "Mua HPG");
  - với mọi vai × hành động × `shared` (true, false): `gate.read` trả đúng loại và đúng trường như bảng kỳ vọng; chuỗi JSON của kết quả không bao giờ chứa "Mua HPG" hay lý do của D1 với vai `main_agent`, `subagent`;
  - kịch bản 1: `subagent` + `system` → chỉ "Không dùng margin";
  - kịch bản 3: `main_agent` + `index` → "HPG" kèm tên ngành "Thép" (`sectorDisplay`, R54; không có văn bản luận điểm) và `#1` "Định giá ngân hàng" (không có tóm tắt); chủ đề mã không thuộc ngành nào thì không có `sectorDisplay`. Bảng kỳ vọng trong test có trường `sectorDisplay` cho luật này;
  - kịch bản 4: vai lạ (ép kiểu) → `read` trả rỗng, `allows` false;
  - kịch bản 5: `activate` chỉ `user` với mọi loại; `main_agent`, `subagent` không bao giờ;
  - mục đã xoá không bao giờ có trong `gate.read` (TC-007);
  - TC-012: `gate`, `reader` không có hàm ghi (`@ts-expect-error gate.addConstraint`, kiểm `Object.keys`); `Object.isFrozen` cả ba;
  - YC-022: không có trạng thái "đề xuất" nào đọc được (kiểu `ThesisState`, trạng thái ràng buộc chỉ có hiệu lực hoặc đã xoá)
- [x] T022 [P] Viết test `test/memory-store-text.test.ts` (đỏ trước):
  - TC-009: với mỗi giới hạn ở plan §3.4, đúng bằng giới hạn lưu được, vượt 1 → `limit`, bản trước giữ nguyên; đếm grapheme ("Hòa Phát" NFD = 8, emoji có tông da = 1);
  - TC-010: xuống dòng, `</memory>`, nháy đơn và kép, tiếng Việt có dấu, emoji → đọc lại giống hệt (đầu vào NFC);
  - rỗng, chỉ khoảng trắng → `invalid`;
  - TC-014: với mỗi loại và mỗi mẫu ở plan §3.4 (khoá giả, không phải khoá thật): `secret`, kho không đổi; `message` của lỗi không chứa chuỗi khoá giả, cũng không chứa 4 ký tự đầu hay cuối của nó; "Tối đa 20% danh mục, P/E dưới 15", "task-force", "risk-on" lưu được
- [x] T023 [S6] Tạo `src/core/memory/policy.ts` (`MEMORY_POLICY`, `policyRule`) theo plan §3.5
- [x] T024 [S6] Tạo `src/core/memory/store/gate.ts` (`read` chiếu theo `fields`, bỏ mục đã xoá, bộ lọc chủ đề và bài học; `allows`); nối vào `open.ts`; `Object.freeze` cho `reader`, `writer`, `gate`
- [x] T025 Tạo `src/core/memory/store/secrets.ts` (mẫu ở plan §3.3) và thêm bước khoá bí mật vào `text.ts`, trước bước giới hạn
- [x] T026 Chạy T021, T022 xanh

**Checkpoint lớp 5:** hai file test xanh; typecheck sạch; `bun test` toàn bộ xanh.

## Giai đoạn cuối: Hoàn thiện

- [x] T027 Chạy đủ bộ kiểm plan §8: typecheck, 8 file test mới, `bun test` toàn bộ; `memory-store-concurrency` 3 lần liền. Ghi số đạt/trượt vào §5 handoff
- [x] T028 Rà style: không dấu chấm phẩy, nháy kép, thụt 2, dòng khoảng 120 ký tự; tên và comment tiếng Anh, câu báo tiếng Việt; comment nói lý do; không trỏ tài liệu ngoài repo
- [x] T029 Cập nhật trạng thái: `docs/memory/specs/README.md` (dòng 001: `implemented`, chờ duyệt code, CI), `docs/STATUS.md`, `CHANGELOG.md` (`[Unreleased]`, tiếng Anh), `tasks.md` này; `spec.md` dòng trạng thái. Ghi rõ: kho chưa nối vào app (spec 002)
- [x] T030 Soạn thông điệp commit `feat(memory): spec 001 …` (không có file lõi; liệt kê file mới) vào §9 handoff; không commit khi chưa được cho phép

## Thứ tự và phụ thuộc

- T001 → lớp 1 (T002–T007) → lớp 2 (T008–T012) → lớp 3 (T013–T015) → lớp 4 (T016–T020) → lớp 5 (T021–T026) → hoàn thiện (T027–T030).
- T003, T004 song song; T008 song song với T009; T016 và T017 song song; T021 và T022 song song.
- Lớp 4 cần lớp 3 (quyết định và bài học tham chiếu chủ đề) và lớp 2 (phiên bản bộ ràng buộc).
- Lớp 5 cần mọi loại đã có (test duyệt bảng tạo một mục mỗi loại). Bước khoá bí mật (T025) thêm vào `text.ts` của lớp 2, nên mọi đường ghi tự được che.

## Gói theo phiên

Người dùng muốn làm liền các gói trong một phiên code, chỉ đổi phiên khi tràn bối cảnh. Mỗi gói kết thúc ở trạng thái typecheck và test xanh, nên dừng ở cuối gói nào cũng an toàn.

| Gói | Việc | Kết thúc ở trạng thái | Chờ duyệt |
| --- | --- | --- | --- |
| 1 | T001–T007: mở kho, lược đồ, đóng kết nối | `memory-store-open` xanh; toàn bộ xanh | — |
| 2 | T008–T012: ràng buộc, cách trình bày, phiên bản bộ ràng buộc, hai tiến trình | thêm `-constraints`, `-concurrency` xanh | — |
| 3 | T013–T015: chủ đề, bí danh, luận điểm | thêm `-theses` xanh | — |
| 4 | T016–T020: bài học, quyết định | thêm `-lessons`, `-decisions` xanh | — |
| 5 | T021–T030: bảng chính sách, cổng đọc, khoá bí mật, hoàn thiện | 8 file xanh; tài liệu cập nhật; thông điệp commit soạn sẵn | cổng 3 (phiên duyệt) |

Không gói nào có việc `[LÕI]`.
