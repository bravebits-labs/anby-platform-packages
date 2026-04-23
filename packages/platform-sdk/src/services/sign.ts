/**
 * Service-app token signing (caller side).
 *
 * A "service app" is a platform-internal app (e.g. god-brain) that is
 * registered in the registry with `kind = SERVICE` and has its own
 * Ed25519 keypair via `ANBY_APP_TOKEN`. Service apps self-sign tokens
 * to authenticate against other apps' protected endpoints.
 *
 * Apps receiving these tokens verify with `createAppVerifier({
 *   acceptIssuers: ['<service-appId>']
 * })` which fetches the service's public key from
 * `/registry/services/{appId}/public-key`.
 *
 * The signed token is a standard scoped-token JWT:
 *
 *   header  = { alg: 'EdDSA', typ: 'JWT' }
 *   payload = { iss, sub, tenantId, scope, exp, iat, jti }
 *
 * `iss` and `sub` are both the service app's appId — service apps
 * authenticate AS themselves (they are not minting tokens for someone
 * else). The verifier on the receiving end pins the iss to its
 * configured allowlist.
 */

import crypto from 'node:crypto';
import { getAppIdentity, type AppIdentity } from '../entities/identity.js';
import type { ScopedTokenClaims } from '../entities/types.js';

export interface SignServiceTokenOptions {
  /** Scope claim, e.g. 'god-brain.feed'. Receiver checks this. */
  scope: string;
  /** Tenant scoping. Required — apps reject tokens missing tenantId. */
  tenantId: string;
  /** Token lifetime in seconds. Default 60s (short-lived). */
  ttlSeconds?: number;
  /** Override identity (for tests). Default uses `getAppIdentity()`. */
  identity?: AppIdentity;
  /** Override clock (for tests). */
  now?: () => Date;
}

/**
 * Sign a scoped JWT with the calling service-app's private key.
 * Returns the compact JWT string.
 */
export function signServiceToken(opts: SignServiceTokenOptions): string {
  const identity = opts.identity ?? getAppIdentity();
  const now = (opts.now ?? (() => new Date()))();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + (opts.ttlSeconds ?? 60);

  const header = { alg: 'EdDSA', typ: 'JWT' };
  const payload: ScopedTokenClaims = {
    iss: identity.appId,
    sub: identity.appId,
    tenantId: opts.tenantId,
    scope: opts.scope,
    exp,
    iat,
    jti: crypto.randomUUID(),
  };

  const h64 = base64url(JSON.stringify(header));
  const p64 = base64url(JSON.stringify(payload));
  const signingInput = Buffer.from(`${h64}.${p64}`);

  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  // Ed25519 (EdDSA): null algorithm in node crypto.sign.
  const sig = crypto.sign(null, signingInput, privateKey);
  const s64 = sig.toString('base64url');

  return `${h64}.${p64}.${s64}`;
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
