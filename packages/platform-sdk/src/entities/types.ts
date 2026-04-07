/**
 * Shared types for the entity sharing layer.
 *
 * Wire format:
 *
 *   Entity name       = "{namespace}.{name}"  e.g. "org.period"
 *   Entity version    = "v{N}"                e.g. "v1"
 *   Qualified name    = "{name}@{version}"    e.g. "org.period@v1"
 *
 * Manifest declares entities as:
 *
 *   provides.entities: [
 *     { name: "org.period", version: "v1", schema: "./schemas/org-period.v1.json" }
 *   ]
 *
 * On publish, the CLI/SDK inlines schema file content into the payload so the
 * registry persists the actual JSON Schema (not a path that only resolves on
 * the publisher's filesystem). See CR-4 in the plan.
 */

export interface EntityProvidesDecl {
  name: string;
  version?: string; // default "v1"
  /** Path (manifest on disk) OR inlined content (publish payload). */
  schema?: string | Record<string, unknown>;
  /** sha256 of the schema content, populated by CLI at publish time. */
  schemaChecksum?: string;
}

/** Parsed from a requires.entities string like "org.period" or "org.period@v1". */
export interface EntityRequiresDecl {
  name: string;
  version: string; // defaults to "v1" when no @v suffix
}

export interface EntityProviderEntry {
  appId: string;
  baseUrl: string;
  entityName: string;
  version: string;
  /** JSON Schema content resolved by registry, null if not declared. */
  schema: Record<string, unknown> | null;
}

/** Shape of GET /registry/entity-map?tenantId=... response. */
export interface EntityMapResponse {
  tenantId: string;
  /** Keyed by "{name}@{version}". */
  entries: Record<string, EntityProviderEntry>;
  /** ETag for polling fallback — hash of sorted entries. */
  etag: string;
}

/** Claims embedded in a scoped service token (JWT). */
export interface ScopedTokenClaims {
  iss: 'anby-registry';
  sub: string; // callerAppId (derived from verified key signature, NOT body)
  tenantId: string;
  scope: string; // e.g. "entity.read"
  exp: number;
  iat: number;
  jti: string;
}

export interface ScopedToken {
  token: string;
  expiresAt: number; // epoch seconds
  claims: ScopedTokenClaims;
}

/** Context passed into entity handler callbacks. Never exposes raw request. */
export interface EntityHandlerContext<TQuery = Record<string, string>> {
  tenantId: string;
  callerAppId: string;
  params: Record<string, string>;
  query: TQuery;
}

export interface EntityHandlerConfig<T = unknown> {
  list?: (
    ctx: EntityHandlerContext,
  ) => Promise<T[]> | T[];
  getById?: (
    ctx: EntityHandlerContext & { id: string },
  ) => Promise<T | null> | T | null;
}

/**
 * Canonical request signature envelope. Every outbound scoped-token request is
 * signed with the caller app's private key over this canonical string so the
 * registry can verify identity without trusting the body.
 */
export interface AppIdentitySignatureHeaders {
  'x-anby-app': string; // the caller claim (verified, not trusted)
  'x-anby-app-keyid': string; // public key id / version
  'x-anby-timestamp': string; // iso8601, prevents replay
  'x-anby-signature': string; // base64 Ed25519 signature over canonical string
}

export function parseEntityRequires(decl: string): EntityRequiresDecl {
  const at = decl.indexOf('@');
  if (at === -1) return { name: decl, version: 'v1' };
  return { name: decl.slice(0, at), version: decl.slice(at + 1) };
}

export function qualifyEntity(name: string, version: string = 'v1'): string {
  return `${name}@${version}`;
}
