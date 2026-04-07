# Anby Platform — SDK packages

Monorepo cho 4 SDK package mà mọi service và app cắm vào Anby Platform sẽ dùng. Tất cả publish lên npmjs.com dưới scope `@anby`.

| Package | npm | Mục đích |
|---|---|---|
| [`@anby/contracts`](https://www.npmjs.com/package/@anby/contracts) | ![npm](https://img.shields.io/npm/v/@anby/contracts) | TypeScript types cho entity, event, notification, search |
| [`@anby/manifest-schema`](https://www.npmjs.com/package/@anby/manifest-schema) | ![npm](https://img.shields.io/npm/v/@anby/manifest-schema) | JSON Schema + Ajv validator cho `manifest.json` |
| [`@anby/platform-sdk`](https://www.npmjs.com/package/@anby/platform-sdk) | ![npm](https://img.shields.io/npm/v/@anby/platform-sdk) | Runtime SDK: auth, events, config |
| [`@anby/cli`](https://www.npmjs.com/package/@anby/cli) | ![npm](https://img.shields.io/npm/v/@anby/cli) | CLI `anby` để scaffold, validate, publish app |

## Dùng SDK trong app của bạn

Đọc [`packages/QUICKSTART.md`](./packages/QUICKSTART.md) — hướng dẫn install, bootstrap, viết manifest, publish app cắm vào platform.

```bash
npm install @anby/platform-sdk @anby/contracts @anby/manifest-schema
npm install -g @anby/cli
```

## Phát triển SDK

```bash
npm install            # link 4 workspace
npm run build          # build cả 4
npm run test           # vitest cho platform-sdk
```

## Release SDK

Đọc [`packages/PUBLISHING.md`](./packages/PUBLISHING.md). Tóm tắt:

```bash
npm run changeset      # mô tả thay đổi
git add . && git commit -m "feat: ..." && git push
```

GitHub Actions tự mở "Version Packages" PR. Merge → SDK auto-publish lên npm.

## License

MIT — xem `LICENSE` trong từng package.
