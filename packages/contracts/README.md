# @anby/contracts

Tập hợp các type contract TypeScript chuẩn cho Anby Platform. Package này là **nguồn chân lý duy nhất** (single source of truth) cho shape của entities, events, notifications và search results được trao đổi giữa các service Anby (auth, tenant, org-chart, event-router, app-registry, ai-employee và các app bên thứ ba).

Mọi service khi tạo ra hoặc tiêu thụ dữ liệu platform đều phải import type từ đây thay vì tự khai báo lại, để khi có breaking change thì lỗi sẽ xuất hiện ngay lúc compile.

## Cài đặt

Được dùng qua workspace link:

```json
{
  "dependencies": {
    "@anby/contracts": "file:../../packages/contracts"
  }
}
```

## Cách dùng

```ts
import type { AnbyUser, AnbyEvent, Notification, SearchResult } from '@anby/contracts';

function handle(evt: AnbyEvent<{ userId: string }>) {
  // ...
}
```

## Cấu trúc

```
src/
├── entities/         # Các domain object cốt lõi
│   ├── user.ts         AnbyUser
│   ├── org-node.ts     Node trong sơ đồ tổ chức
│   ├── task.ts         Task / đầu việc
│   ├── objective.ts    Objective kiểu OKR
│   ├── meeting.ts      Bản ghi cuộc họp
│   └── kudos.ts        Ghi nhận / khen thưởng đồng nghiệp
├── events/           # Envelope sự kiện (tenantId, actor, correlationId, ...)
│   └── envelope.ts     AnbyEvent<T>
├── notifications/    # Payload thông báo
└── search/           # Shape kết quả search dùng chung giữa các service
```

## Quy ước

- **Chỉ chứa type.** Không có runtime code, không dependency. Package build ra type và ship thẳng file `.ts` (`main: src/index.ts`).
- **Envelope có version.** Tất cả event dùng `AnbyEvent<T>` với field `version` — khi có breaking change thì bump version thay vì sửa shape cũ.
- **Ưu tiên thay đổi kiểu additive.** Thêm field optional thay vì đổi tên; mọi service đều import package này, nên một thao tác rename có thể lan ra toàn hệ thống.

## Scripts

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsc
```
