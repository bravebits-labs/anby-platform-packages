/**
 * Browser-safe tenant helpers. Zero Node.js dependencies.
 *
 * Import from '@anby/platform-sdk/tenant' in browser apps to avoid
 * Vite pre-bundling jsonwebtoken/jws (which uses Node's `util.inherits`).
 */

/**
 * Tenant ID placeholders that are NOT real workspaces.
 * - 'default' = JWT issued for users not yet in any workspace (onboarding state)
 * - '__legacy__' = pre-tenant-id legacy DB rows (meeting-service)
 * - 'dev-tenant' = DEV bypass middleware fixture
 *
 * Callers performing tenant-scoped writes should reject these values.
 * Read paths may allow them so the frontend can fetch user state and redirect.
 */
export const INVALID_TENANT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'default',
  '__legacy__',
  'dev-tenant',
]);

export function isPlaceholderTenant(tenantId: string | null | undefined): boolean {
  return !tenantId || INVALID_TENANT_PLACEHOLDERS.has(tenantId);
}
