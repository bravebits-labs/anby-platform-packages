import { describe, it, expect } from 'vitest';
import { isPlaceholderTenant, INVALID_TENANT_PLACEHOLDERS } from './index.js';

describe('isPlaceholderTenant', () => {
  it('returns true for known placeholders', () => {
    expect(isPlaceholderTenant('default')).toBe(true);
    expect(isPlaceholderTenant('__legacy__')).toBe(true);
    expect(isPlaceholderTenant('dev-tenant')).toBe(true);
  });

  it('returns true for empty / null / undefined', () => {
    expect(isPlaceholderTenant('')).toBe(true);
    expect(isPlaceholderTenant(null)).toBe(true);
    expect(isPlaceholderTenant(undefined)).toBe(true);
  });

  it('returns false for valid cuid-like tenantId', () => {
    expect(isPlaceholderTenant('cmtest0000000000000000000ab')).toBe(false);
    expect(isPlaceholderTenant('clx1abcdef0123456789')).toBe(false);
  });

  it('exposes placeholder set for inspection', () => {
    expect(INVALID_TENANT_PLACEHOLDERS.has('default')).toBe(true);
    expect(INVALID_TENANT_PLACEHOLDERS.has('__legacy__')).toBe(true);
    expect(INVALID_TENANT_PLACEHOLDERS.has('dev-tenant')).toBe(true);
    expect(INVALID_TENANT_PLACEHOLDERS.size).toBe(3);
  });
});
