import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT claim conventions for the asymmetric (RS256) auth path. Must match
// anby-auth-service/src/auth/auth.service.ts. All RS256 tokens carry these
// iss/aud/typ claims; all RS256 verifiers enforce them.
//
// PR4 cleanup: HS256 fallback paths removed. SDK is RS256-only.
export const JWT_ISSUER = 'anby-auth-service';
export const JWT_AUDIENCE = 'anby-platform';
export const TYP_USER = 'user';
export const TYP_INTERNAL = 'internal';
export const TYP_OAUTH_STATE = 'oauth-state';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  tenantId: string;
}

/**
 * Auth SDK config. Pass via configureAuth() before any verify* call.
 *
 * After PR4 cleanup, only the RS256 + HMAC fields exist:
 *  - jwtPublicKey: REQUIRED for any user/internal token verification
 *  - hmacSecret: REQUIRED for service-to-service HMAC (registry use case)
 *
 * For services that only verify JWTs and never use HMAC, pass only jwtPublicKey.
 * For services that only use HMAC (e.g. app-registry), pass only hmacSecret.
 */
export interface AuthConfig {
  jwtPublicKey?: string; // RSA-2048 PEM
  hmacSecret?: string; // service-to-service HMAC secret
}

interface InternalConfig {
  jwtPublicKey: string | null;
  hmacSecret: string | null;
}

let _config: InternalConfig | null = null;

/**
 * Configure the SDK's auth state. Call once at service boot, before any
 * verify* call.
 */
export function configureAuth(config: AuthConfig): void {
  const jwtPublicKey = config.jwtPublicKey ?? null;
  const hmacSecret = config.hmacSecret ?? null;

  if (!jwtPublicKey && !hmacSecret) {
    throw new Error(
      'configureAuth: at least one of jwtPublicKey or hmacSecret must be set',
    );
  }

  _config = { jwtPublicKey, hmacSecret };
}

function getConfig(): InternalConfig {
  if (!_config) throw new Error('Auth not configured. Call configureAuth() first.');
  return _config;
}

function payloadToAuthUser(payload: any): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    tenantId: payload.tenantId || 'default',
  };
}

/**
 * Verify a user session JWT (RS256). CRITICAL (cross-token confusion fix):
 * rejects tokens with typ != "user". An internal-token (typ:internal) or
 * oauth-state token (typ:oauth-state) presented as a user session is rejected
 * even if the signature, iss, aud, and exp would all validate.
 */
export function verifyUserJwt(token: string): AuthUser {
  const config = getConfig();
  if (!config.jwtPublicKey) {
    throw new Error('jwtPublicKey not configured');
  }
  if (!token || token.split('.').length !== 3) {
    throw new Error('Invalid token format');
  }
  const payload = jwt.verify(token, config.jwtPublicKey, {
    algorithms: ['RS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: 30,
  }) as any;
  if (payload.typ !== TYP_USER) {
    throw new Error('Wrong token class for user verifier');
  }
  return payloadToAuthUser(payload);
}

/**
 * Verify an internal-service JWT (RS256). CRITICAL: rejects tokens with
 * typ != "internal".
 */
export function verifyInternalJwt(token: string): AuthUser {
  const config = getConfig();
  if (!config.jwtPublicKey) {
    throw new Error('jwtPublicKey not configured');
  }
  if (!token || token.split('.').length !== 3) {
    throw new Error('Invalid token format');
  }
  const payload = jwt.verify(token, config.jwtPublicKey, {
    algorithms: ['RS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: 30,
  }) as any;
  if (payload.typ !== TYP_INTERNAL) {
    throw new Error('Wrong token class for internal verifier');
  }
  return payloadToAuthUser(payload);
}

export function verifyHmac(userValue: string, signature: string): boolean {
  const config = getConfig();
  if (!config.hmacSecret) {
    throw new Error('HMAC not configured. Set hmacSecret in configureAuth().');
  }
  const expected = crypto
    .createHmac('sha256', config.hmacSecret)
    .update(userValue)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Compute an HMAC signature for service-to-service calls. Pair the returned
 * value with the matching `userValue` sent in the `x-internal-user` header;
 * the receiving side calls `verifyHmac` with the same pair.
 */
export function signHmac(userValue: string, secret?: string): string {
  const hmacSecret = secret ?? getConfig().hmacSecret;
  if (!hmacSecret) {
    throw new Error('HMAC not configured. Set hmacSecret in configureAuth().');
  }
  return crypto.createHmac('sha256', hmacSecret).update(userValue).digest('hex');
}

export function authenticateRequest(request: Request): AuthUser | null {
  // Try JWT from Authorization header (user session)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      return verifyUserJwt(authHeader.slice(7));
    } catch {
      return null;
    }
  }

  // Try JWT from cookie (Remix/SSR path)
  const cookies = request.headers.get('cookie') || '';
  const authCookie = cookies.split(';').find(c => c.trim().startsWith('auth-token='));
  if (authCookie) {
    const token = authCookie.split('=')[1]?.trim();
    if (token) {
      try {
        return verifyUserJwt(token);
      } catch {
        return null;
      }
    }
  }

  // Try HMAC (service-to-service). Only if hmacSecret is configured.
  const internalUser = request.headers.get('x-internal-user');
  const internalSig = request.headers.get('x-internal-signature');
  if (internalUser && internalSig) {
    try {
      if (verifyHmac(internalUser, internalSig)) {
        return {
          id: 'internal',
          email: internalUser,
          name: 'Internal Service',
          tenantId: request.headers.get('x-tenant-id') || 'default',
        };
      }
    } catch {
      // hmacSecret not configured — fall through
    }
  }

  return null;
}

export function requireAuth(request: Request): AuthUser {
  const user = authenticateRequest(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return user;
}
