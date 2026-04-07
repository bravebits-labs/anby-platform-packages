# @anby/platform-sdk

SDK runtime mà mọi service Anby (và mọi app được cài thêm) dùng để cắm vào platform. Package này gói gọn ba concern xuyên suốt mà nếu không có nó thì mỗi service sẽ phải tự viết lại:

1. **Auth** — verify JWT đến từ `anby-auth-service` và verify các request service-to-service ký bằng HMAC.
2. **Events** — publish / subscribe event bus của platform qua transport có thể thay thế.
3. **Config** — một entry point `configurePlatform()` duy nhất để các service boot đồng nhất.

Phụ thuộc vào [`@anby/contracts`](../contracts) để dùng envelope sự kiện đã được type sẵn.

## Cài đặt

```json
{
  "dependencies": {
    "@anby/platform-sdk": "file:../../packages/platform-sdk",
    "@anby/contracts":   "file:../../packages/contracts"
  }
}
```

## Cách dùng

### Bootstrap

```ts
import { configurePlatform, configureAuth, configureEventTransport, PostgresEventTransport } from '@anby/platform-sdk';

configurePlatform({ serviceName: 'org-chart', tenantResolver });
configureAuth({ jwtPublicKey: process.env.AUTH_PUBLIC_KEY!, hmacSecret: process.env.SVC_HMAC_SECRET! });
configureEventTransport(new PostgresEventTransport(process.env.DATABASE_URL!));
```

### Xác thực request

```ts
import { requireAuth, type AuthUser } from '@anby/platform-sdk';

app.get('/me', requireAuth(), (req, res) => {
  const user = (req as any).user as AuthUser;
  res.json(user);
});
```

- `verifyJwt(token)` — verify token của end-user.
- `verifyHmac(req)` — verify chữ ký service-to-service.
- `authenticateRequest(req)` — thử JWT trước, fallback sang HMAC.
- `requireAuth()` — middleware kiểu Express/Remix, trả 401 nếu fail.

### Publish một event

```ts
import { createEvent, publishEvent } from '@anby/platform-sdk';

await publishEvent(createEvent({
  type: 'org.node.created',
  tenantId,
  actor: { userId, email },
  data: { nodeId, parentId },
}));
```

Các transport có sẵn:
- **`InMemoryTransport`** — dùng cho test và local dev.
- **`PostgresEventTransport`** — ghi vào bảng outbox để `anby-event-router` tiêu thụ.

## Cấu trúc

```
src/
├── auth/      Verify JWT + HMAC, middleware auth
├── events/    Builder envelope sự kiện + transport có thể thay thế
├── config/    configurePlatform / getPlatformConfig
└── index.ts   Public API — chỉ import từ đây
```

## Scripts

```bash
npm run build    # tsc
npm run test     # vitest
```

## Độ ổn định

Chưa đạt 1.0. Public API là tất cả những gì được re-export từ `src/index.ts`; mọi thứ khác đều là nội bộ và có thể thay đổi mà không báo trước.
