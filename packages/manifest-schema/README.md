# @anby/manifest-schema

JSON Schema + TypeScript type + runtime validator cho **Anby app manifest** — file `manifest.json` mà mọi pluggable app (được cài vào qua `anby-app-registry`) phải cung cấp để platform biết cách mount nó, nó cung cấp / yêu cầu những entity và event nào, render những route nào, và cần những permission gì.

## Cài đặt

```json
{
  "dependencies": {
    "@anby/manifest-schema": "file:../../packages/manifest-schema"
  }
}
```

## Cách dùng

```ts
import { validateManifest, schema, type AppManifest } from '@anby/manifest-schema';

const manifest: unknown = JSON.parse(raw);
const { valid, errors } = validateManifest(manifest);
if (!valid) throw new Error(`Manifest không hợp lệ:\n${errors.join('\n')}`);

// Đến đây manifest có thể dùng an toàn như AppManifest
```

- `validateManifest(obj)` — chạy Ajv với `schema.json`, trả về `{ valid, errors[] }`.
- `schema` — raw JSON Schema, tiện cho việc sinh doc, tooling IDE, hoặc expose qua API.
- `AppManifest` — interface TypeScript tương ứng với schema.

## Shape của manifest (tóm tắt)

```jsonc
{
  "id": "com.anby.org-chart",
  "version": "0.1.0",
  "name": "Org Chart",
  "runtime":  { "type": "nestjs", "port": 4000, "healthCheck": "/health" },
  "frontend": { "type": "iframe", "routes": [{ "path": "/org", "label": "Org" }] },
  "provides": { "entities": ["OrgNode"], "events": ["org.node.created"] },
  "requires": { "platform": ["auth@>=0.1"], "entities": ["User"] },
  "permissions": ["read:users"],
  "database":   { "type": "postgresql", "migrationDir": "./migrations" }
}
```

Xem `src/index.ts` cho interface `AppManifest` đầy đủ và `src/schema.json` cho JSON Schema chuẩn.

## Ai đang dùng package này

- **`anby-app-registry`** — validate manifest lúc install / update app và từ chối những manifest không hợp lệ.
- **Tác giả app** — có thể import type / schema trong build tooling riêng của họ để check ngay lúc compile.

## Scripts

```bash
npm run build    # tsc
```
