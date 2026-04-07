/**
 * Typed errors for the entity sharing layer. Consumers can match on these
 * to render user-visible error states instead of crashing the request.
 */

export class EntityNotInstalledError extends Error {
  readonly code = 'ENTITY_NOT_INSTALLED';
  constructor(
    readonly entityName: string,
    readonly tenantId: string,
  ) {
    super(
      `No installed app provides entity "${entityName}" for tenant "${tenantId}"`,
    );
    this.name = 'EntityNotInstalledError';
  }
}

export class EntityProviderUnreachableError extends Error {
  readonly code = 'ENTITY_PROVIDER_UNREACHABLE';
  constructor(
    readonly entityName: string,
    readonly baseUrl: string,
    readonly cause?: unknown,
  ) {
    super(
      `Entity provider at ${baseUrl} for "${entityName}" is unreachable`,
    );
    this.name = 'EntityProviderUnreachableError';
  }
}

export class EntitySchemaViolationError extends Error {
  readonly code = 'ENTITY_SCHEMA_VIOLATION';
  constructor(
    readonly entityName: string,
    readonly errors: string[],
  ) {
    super(
      `Response for entity "${entityName}" violated schema:\n  - ${errors.join('\n  - ')}`,
    );
    this.name = 'EntitySchemaViolationError';
  }
}

export class ScopedTokenError extends Error {
  readonly code = 'SCOPED_TOKEN_ERROR';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ScopedTokenError';
  }
}

export class TenantMismatchError extends Error {
  readonly code = 'TENANT_MISMATCH';
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Tenant mismatch: expected "${expected}", got "${actual}"`);
    this.name = 'TenantMismatchError';
  }
}
