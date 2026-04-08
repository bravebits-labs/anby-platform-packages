/**
 * Types for the third-party app bootstrap flow
 * (PLAN-app-bootstrap.md PR2).
 *
 * `AnbyAppToken` is the parsed payload of the `ANBY_APP_TOKEN` env var.
 * The wire format is `anby_v1_<base64url(json(AnbyAppToken))>`.
 *
 * `DiscoveryResponse` is what `GET /registry/discovery` returns.
 */

export const ANBY_TOKEN_PREFIX = 'anby_v1_';

export interface AnbyAppToken {
  v: 1;
  appId: string;
  /** Externally-reachable platform base URL, e.g. "https://anby.io". */
  platformUrl: string;
  /** PEM-encoded Ed25519 private key for service-to-service signing. */
  privateKey: string;
}

export interface DiscoveryResponse {
  v: 1;
  platform: {
    name: string;
    version: string;
  };
  endpoints: {
    authPublicKeyUrl: string;
    scopedTokenUrl: string;
    entityTokenPublicKeyUrl: string;
    /** PR1 of phase2: events ingestion endpoint. Optional for back-compat
     *  with older registries that don't expose it yet. */
    eventsUrl?: string;
    gatewayUrl: string;
    /** Registry HTTP API root with /registry suffix already appended.
     *  Existing callers expect this exact shape. */
    registryUrl: string;
    /** PR3 of phase2: registry HOST root WITHOUT /registry suffix.
     *  Optional for back-compat with older registries. */
    registryBaseUrl?: string;
    tenantServiceUrl: string;
    eventRouterUrl: string;
  };
  cacheTtlSeconds: number;
}

export interface CachedBootstrap {
  /** When the discovery response was fetched (ISO 8601). */
  fetchedAt: string;
  /** When this cache entry should be considered stale (ISO 8601). */
  staleAt: string;
  discovery: DiscoveryResponse;
  /** PEM string of the auth-service public key (RS256). */
  authPublicKeyPem: string;
}
