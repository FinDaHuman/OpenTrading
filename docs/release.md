# Phát hành bản mới (cho người bảo trì)

Bản cài cho người dùng là binary build sẵn (Bun nằm trong), đăng ở
[GitHub Releases](https://github.com/FinDaHuman/OpenTrading/releases). Script cài (`install.sh`,
`install.ps1`) và `opentrading update` luôn lấy bản `releases/latest`.

## Chuẩn bị một lần: npm

Mỗi bản còn được đăng lên npm (`npm i -g opentrading`): gói `opentrading` (launcher Node) và một gói cho mỗi nền
tảng (`opentrading-windows-x64`, …) chứa binary (`scripts/npm.ts`). Trước tag đầu tiên:

1. Tạo tài khoản trên [npmjs.com](https://www.npmjs.com), bật 2FA.
2. Tạo **Granular Access Token** quyền *Read and write* cho các gói `opentrading` và `opentrading-*`
   (lần đầu các gói chưa có: chọn quyền cho mọi gói của tài khoản, sau đó thu hẹp lại).
3. GitHub → Settings → Secrets and variables → Actions → **New repository secret** `NPM_TOKEN`.

Thiếu `NPM_TOKEN` thì job `npm` lỗi và release vẫn là nháp: không ai được báo bản mới.

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
   - job `npm` đăng các gói (bản đã có trên npm thì bỏ qua, nên chạy lại được), xong mới bỏ nháp. Release còn nháp thì `releases/latest` chưa thấy nó, nên
     không ai được báo cập nhật lên bản mà một kênh chưa có.
5. Workflow lỗi giữa chừng: sửa, xoá release nháp và tag (`git push --delete origin v0.2.0`), rồi đẩy tag lại.

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
