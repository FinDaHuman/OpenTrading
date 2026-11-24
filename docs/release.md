# Phát hành bản mới (cho người bảo trì)

Bản cài cho người dùng là binary build sẵn (Bun nằm trong), đăng ở
[GitHub Releases](https://github.com/FinDaHuman/OpenTrading/releases). Script cài (`install.sh`,
`install.ps1`) và `opentrading update` luôn lấy bản `releases/latest`.

## Chuẩn bị một lần: npm

Mỗi bản còn được đăng lên npm (`npm i -g @findahuman/opentrading`): gói `@findahuman/opentrading` (launcher Node; tên không scope `opentrading` bị npm từ chối vì quá giống `opentracing`) và một gói cho mỗi nền
tảng (`opentrading-windows-x64`, …) chứa binary (`scripts/npm.ts`). Trước tag đầu tiên:

1. Tạo tài khoản trên [npmjs.com](https://www.npmjs.com), bật 2FA.
2. Tạo **Granular Access Token** quyền *Read and write* cho các gói `@findahuman/opentrading` và `opentrading-*`
   (lần đầu các gói chưa có: chọn quyền cho mọi gói của tài khoản, sau đó thu hẹp lại).
   - Đánh dấu **Bypass two-factor authentication**. Không có nó thì `npm publish` trong CI lỗi `EOTP`, vì tài
     khoản đã bật 2FA.
   - Phần *Packages and scopes*: chọn **Read and write (publish and stage)** và **All packages** (gói chưa
     có nên chưa chọn riêng được). "stage only" không dùng được cho CI: bản stage phải duyệt tay trên npmjs.com.
   - Token có quyền ghi sống tối đa **90 ngày** (quy định của npm từ 11/2025). Ghi ngày hết hạn lại; hết hạn thì
     job `npm` lỗi và release kẹt ở nháp. Token hiện tại tạo ngày 23/10/2026, muộn nhất 21/01/2027 là hết hạn.
   - npm báo (23/10/2026): token bypass-2FA đăng thẳng sẽ **bị bỏ vào tháng 01/2027**. Token chỉ dùng cho các bản
     đầu; trước 01/2027 phải chuyển sang trusted publishing (phần dưới).
3. GitHub → Settings → Secrets and variables → Actions → **New repository secret** `NPM_TOKEN`.

Thiếu `NPM_TOKEN` (khi chưa có trusted publishing) thì job `npm` lỗi và release vẫn là nháp: không ai được báo bản mới.

### Chuyển sang trusted publishing (trước 01/2027)

npm nhận thẳng danh tính của workflow (OIDC), không cần token. Cấu hình mới **hết hạn nếu sau 2 ngày chưa đăng được
bản nào**, nên chỉ làm ngay trước khi phát hành:

1. Trên máy của chủ gói (npm 11.15 trở lên): `npm login`, rồi `bun scripts/npm-trust.ts --yes`. Lệnh đầu hỏi 2FA
   trên trình duyệt; chọn bỏ qua 2FA trong 5 phút để 9 gói còn lại không hỏi lại. Không có `--yes` thì chỉ in lệnh.
   Cách khác: làm tay từng gói trên npmjs.com → Settings → Trusted publisher → GitHub Actions, repo
   `FinDaHuman/OpenTrading`, workflow `release.yml`, không có environment, **cho phép `npm publish`** (mặc định của
   npm chỉ cho `npm stage publish`).
2. Phát hành trong vòng 2 ngày. npm thử OIDC trước, không được thì **lặng lẽ** dùng `NPM_TOKEN`; job `npm` in
   cảnh báo cho gói nào vẫn đăng bằng token.
3. Không còn cảnh báo nào: bỏ `NODE_AUTH_TOKEN` trong `release.yml`, xoá secret `NPM_TOKEN` và token trên npmjs.com.
   Rồi ở từng gói: Settings → Publishing access → *Require two-factor authentication and disallow tokens*.

Đổi tên `release.yml` hoặc repo thì phải tạo lại cấu hình (npm so đúng tên, phân biệt hoa thường).

## Các bước

1. Mở PR đổi `"version"` trong `package.json` (SemVer, ví dụ `0.2.0`) và đổi mục
   `## [Unreleased]` của `CHANGELOG.md` thành `## [0.2.0] — <ngày>` (giữ một mục `[Unreleased]` trống ở trên).
2. Merge PR khi CI xanh.
3. Từ `main` đã cập nhật, đẩy tag đúng bằng version:

   ```shell
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Workflow **Release** (`.github/workflows/release.yml`):
   - kiểm tag = `package.json` và CHANGELOG có mục của version đó;
   - build 9 binary trên runner Windows, Ubuntu, macOS (`bun run build --targets …`), ký ad-hoc bản macOS,
     chạy `--self-check` với bản của chính runner, nén (`scripts/package.ts`);
   - tạo release **nháp** kèm các file nén + `SHA256SUMS`, ghi chú lấy từ CHANGELOG (`scripts/release-notes.ts`);
   - job `npm` đăng các gói nền tảng, chờ npm thật sự phục vụ đủ (bản 0.5.0: 2–6 phút sau khi `npm publish` báo xong),
     mới đăng gói chính rồi chờ tiếp (bản đã có trên npm thì bỏ qua, nên chạy lại được); xong mới bỏ nháp. Release còn nháp thì `releases/latest` chưa thấy nó, nên
     không ai được báo cập nhật lên bản mà một kênh chưa có.
   - job `verify` (`verify-release.yml`) cài bản vừa phát hành trên máy thật của từng hệ điều hành và CPU: script cài,
     `ot update` từ bản trước, npm cài mới và nâng cấp, mở TUI (macOS, Linux). Chạy tay lúc nào cũng được: Actions →
     Verify release (kiểm bản mới nhất). Job này đỏ nghĩa là bản **đã phát hành** có người không cài được.
5. Job `npm` lỗi: **giữ nguyên tag**, sửa nguyên nhân (token, npm chậm) rồi chạy lại các job lỗi
   (`gh run rerun <id> --failed`). Version đã lên npm không đăng lại được.
6. Lỗi trước khi có gì lên npm: sửa, xoá release nháp và tag (`git push --delete origin v0.2.0`), rồi đẩy tag lại.

## Chạy thử không phát hành

Actions → Release → **Run workflow** trên một nhánh: chỉ build, nén và đính các file nén vào lần chạy
(artifact), không tạo release.

Build tại máy:

```shell
bun run build --single        # chỉ nền tảng của máy này, kèm --version và --self-check
bun run build                 # cả 9 nền tảng (build chéo); bản macOS chưa ký thì chỉ để thử
bun scripts/package.ts        # nén vào dist/release/
```

## Nền tảng

| Tên | Ghi chú |
| --- | --- |
| `windows-x64`, `windows-arm64` | `.zip` |
| `linux-x64`, `linux-arm64` | `.tar.gz`, glibc (chưa có bản musl/Alpine) |
| `darwin-arm64`, `darwin-x64` | `.zip`, ký ad-hoc |
| `*-x64-baseline` | CPU x64 không có AVX2 (Windows, Linux, macOS) |

Binary chưa ký bằng chứng chỉ: Windows SmartScreen có thể cảnh báo lần đầu chạy; file tải bằng trình duyệt
trên macOS bị Gatekeeper chặn (script cài dùng `curl` nên không bị).
