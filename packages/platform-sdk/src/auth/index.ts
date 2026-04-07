import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  tenantId: string;
}

export interface AuthConfig {
  jwtSecret: string;
  internalApiSecret: string;
}

let _config: AuthConfig | null = null;

export function configureAuth(config: AuthConfig): void {
  _config = config;
}

function getConfig(): AuthConfig {
  if (!_config) throw new Error('Auth not configured. Call configureAuth() first.');
  return _config;
}

export function verifyJwt(token: string): AuthUser {
  const config = getConfig();
  const payload = jwt.verify(token, config.jwtSecret) as {
    sub: string;
    email: string;
    name?: string;
    tenantId?: string;
  };
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    tenantId: payload.tenantId || 'default',
  };
}

export function verifyHmac(userValue: string, signature: string): boolean {
  const config = getConfig();
  const expected = crypto
    .createHmac('sha256', config.internalApiSecret)
    .update(userValue)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Compute an HMAC signature for service-to-service calls. Pair the returned
 * value with the matching `userValue` sent in the `x-internal-user` header;
 * the receiving side calls `verifyHmac` with the same pair.
 */
export function signHmac(userValue: string, secret?: string): string {
  const internalApiSecret = secret ?? getConfig().internalApiSecret;
  return crypto
    .createHmac('sha256', internalApiSecret)
    .update(userValue)
    .digest('hex');
}

export function authenticateRequest(request: Request): AuthUser | null {
  // Try JWT from Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      return verifyJwt(authHeader.slice(7));
    } catch {
      return null;
    }
  }

  // Try JWT from cookie
  const cookies = request.headers.get('cookie') || '';
  const authCookie = cookies.split(';').find(c => c.trim().startsWith('auth-token='));
  if (authCookie) {
    const token = authCookie.split('=')[1]?.trim();
    if (token) {
      try {
        return verifyJwt(token);
      } catch {
        return null;
      }
    }
  }

  // Try HMAC (service-to-service)
  const internalUser = request.headers.get('x-internal-user');
  const internalSig = request.headers.get('x-internal-signature');
  if (internalUser && internalSig && verifyHmac(internalUser, internalSig)) {
    return {
      id: 'internal',
      email: internalUser,
      name: 'Internal Service',
      tenantId: request.headers.get('x-tenant-id') || 'default',
    };
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
