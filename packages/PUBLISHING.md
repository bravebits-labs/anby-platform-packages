# Publishing the `@anby/*` SDK packages

Hướng dẫn này dành cho **maintainer** — người chịu trách nhiệm release các package `@anby/contracts`, `@anby/manifest-schema`, `@anby/platform-sdk`, `@anby/cli` lên npmjs.com.

> Nếu bạn chỉ muốn **dùng** SDK trong app của mình, đọc [`QUICKSTART.md`](./QUICKSTART.md) thay vì file này.

---

## Mô hình release

- **Registry:** npmjs.com công khai, scope `@anby` (đã được claim).
- **Tooling:** [Changesets](https://github.com/changesets/changesets) để bump version + sinh CHANGELOG.
- **CI:** GitHub Actions workflow `.github/workflows/release.yml` tự động tạo Release PR khi có pending changeset, và publish khi PR được merge.
- **Linked versioning:** 4 package được khai báo `linked` trong `.changeset/config.json` → chúng luôn cùng version. Bump 1 cái thì cả 4 cùng bump.
- **Provenance:** mỗi lần publish gắn sigstore attestation (`--provenance`) để verify nguồn gốc.

---

## Setup lần đầu (chỉ làm 1 lần)

### 1. Claim scope `@anby` trên npmjs.com

Đã xong ✅ — scope `anby` đã được tạo. Verify ở https://www.npmjs.com/~anby.

### 2. Tạo npm Automation Token

Token này dùng cho GitHub Actions publish. Nó phải là **Automation** token (không bị 2FA chặn).

```
npmjs.com → Profile → Access Tokens → Generate New Token → Classic Token
   Type: Automation
   Tên: anby-platform-ci
```

Copy token (chỉ hiện 1 lần).

### 3. Add token vào GitHub repo secrets

```
github.com/bravebits-labs/anby-platform-packages → Settings → Secrets and variables → Actions
   New repository secret
   Name:  NPM_TOKEN
   Value: <token vừa copy>
```

### 4. Bật npm provenance trên repo

GitHub Actions sẽ ký provenance bằng OIDC. Chỉ cần workflow có `permissions: id-token: write` (đã có sẵn trong `release.yml`). Không cần config thêm.

### 5. Cài dependencies ở root

```bash
cd /Users/william/anby-project
npm install
```

Lệnh này cài `@changesets/cli` và link 4 workspace package với nhau.

### 6. Smoke-test build local

```bash
npm run build
```

Phải pass cả 4 package. Nếu fail → fix trước khi push lên main.

---

## Workflow release thường ngày

### Bước 1 — Code thay đổi như bình thường

Sửa code trong `packages/<tên>/src/...`. Không cần bump version tay.

### Bước 2 — Tạo changeset

```bash
npm run changeset
```

CLI hỏi:
- **Package nào thay đổi?** — chọn 1 hoặc nhiều (space để chọn). Vì 4 package được `linked`, chọn 1 cũng đủ — version sẽ đồng bộ.
- **Loại bump?** — `patch` (bug fix), `minor` (feature mới), `major` (breaking change).
- **Tóm tắt?** — 1-2 dòng tả thay đổi (sẽ vào CHANGELOG).

Lệnh sinh ra 1 file `.md` trong `.changeset/`. **Commit nó cùng code change**:

```bash
git add packages/ .changeset/
git commit -m "feat(platform-sdk): add new event transport"
git push
```

### Bước 3 — GitHub Actions tự lo phần còn lại

Khi push lên `main`:

1. Workflow `release.yml` chạy.
2. Nếu phát hiện pending changeset → **mở (hoặc cập nhật) Pull Request "chore: version packages"**. PR này:
   - Bump version trong cả 4 `package.json`
   - Sinh / cập nhật `CHANGELOG.md` cho từng package
   - Xóa file changeset đã tiêu thụ
3. Bạn review PR đó. Nếu đúng → **merge**.
4. Workflow chạy lại sau merge → phát hiện không còn changeset pending → **publish 4 package lên npm** với version mới.

### Bước 4 — Verify

```bash
npm view @anby/contracts versions --json
npm view @anby/platform-sdk versions --json
```

Phải thấy version mới. Cũng check trang npmjs.com:
- https://www.npmjs.com/package/@anby/contracts
- https://www.npmjs.com/package/@anby/manifest-schema
- https://www.npmjs.com/package/@anby/platform-sdk
- https://www.npmjs.com/package/@anby/cli

---

## Publish thủ công (khi cần debug hoặc lần đầu tiên)

Lần publish đầu tiên thường nên làm thủ công để xác nhận mọi thứ OK trước khi giao cho CI.

```bash
# 1. Login
npm login
# username: anby (hoặc tài khoản có quyền trên scope @anby)

# 2. Build sạch
cd /Users/william/anby-project
rm -rf packages/*/dist
npm install
npm run build

# 3. Publish theo thứ tự (vì có inter-dependency)
cd packages/contracts        && npm publish
cd ../manifest-schema        && npm publish
cd ../platform-sdk           && npm publish
cd ../anby-cli               && npm publish
```

> **Thứ tự bắt buộc**: `contracts` → `manifest-schema` → `platform-sdk` → `anby-cli`.
> Vì `platform-sdk` depend `@anby/contracts` + `@anby/manifest-schema`, và `@anby/cli` depend cả 3.

### Dry-run trước khi publish thật

```bash
cd packages/contracts
npm pack --dry-run
```

Lệnh này show file nào sẽ vào tarball mà không publish. Verify rằng:
- ✅ `dist/` có mặt
- ✅ `LICENSE`, `README.md`, `package.json` có mặt
- ❌ `node_modules`, `*.test.ts`, `tsconfig*.json` **không** có mặt

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `403 Forbidden — You do not have permission to publish` | Chưa login, hoặc tài khoản không thuộc scope `anby` | `npm login` lại bằng user `anby` |
| `402 Payment Required` | Quên `"access": "public"` trong `publishConfig` | Đã có sẵn trong cả 4 package.json — verify lại |
| `cannot publish over existing version` | Version đã tồn tại trên registry | Tạo changeset mới và bump version |
| `npm ERR! workspace not found` (CI) | Chưa có root `package.json` với `workspaces` | Đã có sẵn ở `/Users/william/anby-project/package.json` |
| `provenance failed: missing OIDC token` | Workflow thiếu `permissions: id-token: write` | Đã có sẵn trong `release.yml` |
| Changeset PR không tự mở | `NPM_TOKEN` secret chưa được set, hoặc workflow chạy fail | Check tab Actions trên GitHub |

---

## Unpublish (chỉ khi tuyệt đối cần)

npm cấm unpublish package > 72h tuổi và có dependent. Nếu lỡ publish phiên bản hỏng:

```bash
# Trong vòng 72h và không ai đã install:
npm unpublish @anby/contracts@0.1.0

# Sau 72h hoặc có dependent: chỉ deprecate được
npm deprecate @anby/contracts@0.1.0 "Có bug nghiêm trọng — dùng 0.1.1+"
```

Nguyên tắc: **luôn publish lên trên** thay vì rút xuống.

---

## Kiểm tra checklist trước mỗi release lớn

- [ ] `npm run build` pass cả 4 package
- [ ] `npm run typecheck` pass (nếu package có)
- [ ] `npm run test` pass (platform-sdk có vitest)
- [ ] `npm pack --dry-run` cho từng package — nội dung tarball gọn gàng
- [ ] CHANGELOG đã được Changesets cập nhật và đọc hợp lý
- [ ] README của từng package vẫn còn đúng (URL, ví dụ code)
- [ ] Đã smoke-test bằng cách `npm install @anby/platform-sdk@<new>` trong 1 project trống

---

## Cấu trúc liên quan

```
/Users/william/anby-project/
├── package.json                    Root workspace + scripts (changeset, release)
├── .changeset/
│   ├── config.json                 Linked packages, baseBranch, access
│   └── README.md                   Hướng dẫn ngắn cho contributor
├── .github/workflows/release.yml   CI auto-version + publish
└── packages/
    ├── contracts/
    ├── manifest-schema/
    ├── platform-sdk/
    └── anby-cli/
```
