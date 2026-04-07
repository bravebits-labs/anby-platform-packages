# Anby Platform SDK — Quickstart

Hướng dẫn này dành cho **dev viết app cắm vào Anby Platform**. Sau ~10 phút bạn sẽ có một app NestJS / Express / Next.js có thể auth được người dùng platform, publish event ra event bus, và đăng ký với app registry qua manifest.

> Nếu bạn là maintainer cần release SDK, đọc [`PUBLISHING.md`](./PUBLISHING.md).

---

## Bộ package

Toàn bộ SDK được publish trên npmjs.com dưới scope `@anby`:

| Package | Mục đích |
|---|---|
| [`@anby/contracts`](https://www.npmjs.com/package/@anby/contracts) | TypeScript types cho entity, event, notification, search. Single source of truth — cả platform và app đều import từ đây. |
| [`@anby/manifest-schema`](https://www.npmjs.com/package/@anby/manifest-schema) | JSON Schema + Ajv validator + type cho `manifest.json` của app. |
| [`@anby/platform-sdk`](https://www.npmjs.com/package/@anby/platform-sdk) | Runtime: verify JWT/HMAC, publish/subscribe event, bootstrap config. |
| [`@anby/cli`](https://www.npmjs.com/package/@anby/cli) | CLI `anby` để scaffold, validate manifest, publish app lên registry. |

Cả 4 package luôn cùng version.

---

## 1. Cài đặt

```bash
# Trong project app của bạn
npm install @anby/platform-sdk @anby/contracts @anby/manifest-schema

# CLI cài global cho tiện
npm install -g @anby/cli
```

Yêu cầu: **Node.js 20+**, TypeScript 5.5+.

Verify:
```bash
anby --version    # → 0.1.0
```

---

## 2. Scaffold một app mới

```bash
anby init my-org-app
cd my-org-app
npm install
```

`anby init` tạo:
```
my-org-app/
├── manifest.json          Khai báo app cho platform
├── package.json           Đã có sẵn 3 dep @anby/*
├── src/
│   ├── index.ts           Entrypoint, bootstrap SDK
│   └── routes/
│       └── health.ts
└── tsconfig.json
```

---

## 3. Bootstrap SDK

Trong `src/index.ts`:

```ts
import {
  configurePlatform,
  configureAuth,
  configureEventTransport,
  PostgresEventTransport,
} from '@anby/platform-sdk';

// 1. Khai báo service
configurePlatform({
  serviceName: 'my-org-app',
  tenantResolver: (req) => req.headers['x-tenant-id'] as string,
});

// 2. Setup auth (verify JWT từ anby-auth-service + HMAC service-to-service)
configureAuth({
  jwtPublicKey: process.env.ANBY_AUTH_PUBLIC_KEY!,
  hmacSecret: process.env.ANBY_SVC_HMAC_SECRET!,
});

// 3. Setup event transport (đẩy event vào outbox để event-router tiêu thụ)
configureEventTransport(
  new PostgresEventTransport(process.env.DATABASE_URL!)
);

// Sau đó boot framework của bạn (Express/NestJS/Next.js…)
```

Env tối thiểu:
```env
ANBY_AUTH_PUBLIC_KEY=...   # Public key của anby-auth-service, do platform cấp
ANBY_SVC_HMAC_SECRET=...   # HMAC secret cho service-to-service
DATABASE_URL=postgres://...
```

---

## 4. Bảo vệ route bằng `requireAuth()`

```ts
import express from 'express';
import { requireAuth, type AuthUser } from '@anby/platform-sdk';

const app = express();

app.get('/me', requireAuth(), (req, res) => {
  const user = (req as any).user as AuthUser;
  res.json({ id: user.id, email: user.email, roles: user.roles });
});
```

`requireAuth()` thử JWT trước, fallback sang HMAC. Trả 401 nếu cả hai đều fail.

Các helper khác:
- `verifyJwt(token)` — verify token end-user, trả `AuthUser`.
- `verifyHmac(req)` — verify chữ ký service-to-service.
- `authenticateRequest(req)` — như `requireAuth` nhưng không quăng lỗi, trả `AuthUser | null`.

---

## 5. Publish event ra platform bus

```ts
import { createEvent, publishEvent } from '@anby/platform-sdk';
import type { AnbyEvent } from '@anby/contracts';

await publishEvent(createEvent({
  type: 'org.node.created',
  tenantId: 'tenant-123',
  actor: { userId: 'user-456', email: 'a@example.com' },
  data: { nodeId: 'node-789', parentId: 'node-001' },
}));
```

`createEvent` gắn version, correlationId, timestamp. `publishEvent` đẩy vào transport bạn đã cấu hình ở bước 3.

Transport có sẵn:
- `InMemoryTransport` — cho test/local dev.
- `PostgresEventTransport` — ghi vào outbox table để `anby-event-router` poll & forward.

---

## 6. Khai manifest

Sửa `manifest.json` mà `anby init` đã tạo:

```jsonc
{
  "id": "com.your-org.my-org-app",
  "version": "0.1.0",
  "name": "My Org App",
  "runtime": {
    "type": "container",
    "image": "ghcr.io/your-org/my-org-app:0.1.0",
    "port": 4000,
    "healthCheck": "/health"
  },
  "frontend": {
    "type": "iframe",
    "routes": [
      { "path": "/my-app", "label": "My App" }
    ]
  },
  "provides": {
    "entities": ["MyEntity"],
    "events":   ["my.entity.created", "my.entity.updated"]
  },
  "requires": {
    "platform": ["auth@>=0.1", "events@>=0.1"],
    "entities": ["User", "OrgNode"]
  },
  "permissions": ["read:users", "read:org-nodes"],
  "database": {
    "type": "postgresql",
    "migrationDir": "./migrations"
  }
}
```

Validate ngay tại chỗ:

```bash
anby validate
# ✓ manifest.json hợp lệ
```

Hoặc programmatic:

```ts
import { validateManifest } from '@anby/manifest-schema';

const result = validateManifest(JSON.parse(raw));
if (!result.valid) throw new Error(result.errors.join('\n'));
```

---

## 7. Publish app lên Anby App Registry

```bash
anby login --registry https://registry.anby.example.com
anby publish
```

Lệnh `publish`:
1. Validate `manifest.json`.
2. Build artifact (container image hoặc bundle, theo `runtime.type`).
3. Upload + đăng ký với app registry.

Sau đó tenant admin có thể:

```bash
anby install com.your-org.my-org-app@0.1.0 --tenant my-tenant
```

App của bạn được mount vào `https://anby.example.com/my-app` (theo `frontend.routes[0].path`) và bắt đầu nhận event.

---

## 8. Type sharing với `@anby/contracts`

Bất cứ khi nào bạn nhận / phát data về platform entity, **import type từ `@anby/contracts`** thay vì tự khai báo lại:

```ts
import type {
  AnbyUser,
  AnbyOrgNode,
  AnbyEvent,
  AnbyTask,
  AnbyObjective,
  AnbyMeeting,
  AnbyKudos,
  AnbyNotification,
  AnbySearchResult,
} from '@anby/contracts';

function handleUserCreated(evt: AnbyEvent<{ user: AnbyUser }>) {
  // ...
}
```

Lợi ích: khi platform bump shape của `AnbyUser`, app của bạn lỗi compile ngay → fix sớm thay vì sập runtime.

---

## 9. Test local không cần platform thật

Dùng `InMemoryTransport` để test phần publish event:

```ts
import { configureEventTransport, InMemoryTransport, publishEvent, createEvent } from '@anby/platform-sdk';

const transport = new InMemoryTransport();
configureEventTransport(transport);

await publishEvent(createEvent({ type: 'my.test', tenantId: 't1', data: {} }));
console.log(transport.published); // → [{ type: 'my.test', ... }]
```

---

## Cấu trúc thư mục đề xuất

```
my-org-app/
├── manifest.json
├── package.json
├── tsconfig.json
├── Dockerfile
├── migrations/
└── src/
    ├── index.ts              configurePlatform + boot framework
    ├── routes/
    ├── handlers/             event handlers
    ├── services/             domain logic
    └── types/                kiểu domain riêng (entity public dùng @anby/contracts)
```

---

## FAQ

**Q: Bắt buộc dùng NestJS / Express không?**
Không. SDK chỉ là helper function — `verifyJwt`, `publishEvent`, ... gọi từ bất cứ runtime Node nào. `requireAuth()` là middleware kiểu Express, nhưng bạn có thể tự gọi `verifyJwt` trong adapter framework khác.

**Q: SDK có chạy được trong Edge runtime / Cloudflare Workers?**
Hiện tại chưa. SDK depend `jsonwebtoken` và `ioredis` — chỉ chạy trong Node 20+. Edge support đang trong roadmap.

**Q: Làm sao bump version SDK trong app của tôi?**
```bash
npm update @anby/contracts @anby/manifest-schema @anby/platform-sdk
```
Vì 4 package được linked-version, bạn nên update đồng loạt cùng version để tránh lệch type.

**Q: Tôi không có Postgres, có cách nào publish event khác không?**
Implement interface `EventTransport` của bạn. SDK chỉ cần `publish(event)` method. Có thể wrap Kafka, RabbitMQ, NATS, ...

**Q: Manifest có support hot-reload không?**
Không. Mọi thay đổi manifest đòi `anby publish` → bump version → tenant `anby install` lại.

---

## Lấy hỗ trợ

- 🐛 Bug / feature request: https://github.com/bravebits-labs/anby-platform-packages/issues
- 📖 Source & ví dụ: https://github.com/bravebits-labs/anby-platform-packages
- 💬 Discussions: https://github.com/bravebits-labs/anby-platform-packages/discussions
