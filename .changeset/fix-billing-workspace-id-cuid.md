---
'@anby/billing': patch
---

Accept Prisma CUID workspace ids (in addition to UUIDs) at the SDK boundary.

`DebitRequestSchema.workspaceId` and `RefundRequestSchema.workspaceId` previously
used `z.string().uuid()`, which rejected the platform's actual tenant ids — they
are CUIDs from `tenant-service`'s `Tenant.id @default(cuid())`. Calling
`debitCredits()` with a real `user.tenantId` would therefore throw
`ZodError` SDK-side before any HTTP request was sent.

The relaxed predicate (`isWorkspaceId` / `workspaceIdSchema`) matches the
server-side validator at `anby-billing-service/src/lib/workspace-id.ts`
(UUID OR Prisma CUID, ≤128 chars). Both helpers are now exported from the
package root for downstream consumers that want to pre-validate ids before
SDK calls.

This change strictly widens the accepted set — every UUID accepted by `1.0.0`
remains valid in `1.0.1` — so it is fully backward-compatible.
