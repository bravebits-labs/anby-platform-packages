/**
 * Per-app service identity (CR-1).
 *
 * Each published app gets its own Ed25519 key pair:
 *   - Private key lives in the app service's env APP_PRIVATE_KEY (PEM).
 *   - Public key is uploaded to the registry at publish time and stored on
 *     the App row. Registry verifies signatures with that public key.
 *
 * We NEVER trust callerAppId from the request body. The registry derives
 * the identity from the signature: the only app whose public key can
 * verify the signature IS the caller. If the verification fails, the
 * request is rejected outright.
 *
 * Canonical signature string (kept simple and versioned):
 *
 *   ANBY-APP-V1\n
 *   {callerAppId}\n
 *   {tenantId}\n
 *   {isoTimestamp}\n
 *   {bodySha256Hex}
 *
 * Timestamp must be within ±5 minutes of server clock. Body checksum binds
 * the signature to the specific request so it can't be replayed against a
 * different body.
 */

import crypto from 'crypto';

export interface AppIdentity {
  appId: string;
  privateKeyPem: string;
}

export interface SignedRequestHeaders {
  'x-anby-app': string;
  'x-anby-timestamp': string;
  'x-anby-body-sha256': string;
  'x-anby-signature': string;
}

export interface AppKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generate an Ed25519 key pair. Used by registry at app publish time —
 * private key returned once to the publisher, public key persisted.
 */
export function generateAppKeyPair(): AppKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

export function hashBody(body: string | Buffer | undefined): string {
  if (body === undefined || body === null) body = '';
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function canonicalSigString(params: {
  callerAppId: string;
  tenantId: string;
  isoTimestamp: string;
  bodySha256: string;
}): string {
  return (
    'ANBY-APP-V1\n' +
    params.callerAppId +
    '\n' +
    params.tenantId +
    '\n' +
    params.isoTimestamp +
    '\n' +
    params.bodySha256
  );
}

/**
 * Caller side: sign a request with the app's private key and return the
 * headers to attach. Body must be the exact serialized bytes that will be
 * sent on the wire (JSON.stringify for JSON bodies).
 */
export function signAppRequest(params: {
  identity: AppIdentity;
  tenantId: string;
  body?: string;
  now?: Date;
}): SignedRequestHeaders {
  const iso = (params.now ?? new Date()).toISOString();
  const bodySha = hashBody(params.body);
  const canonical = canonicalSigString({
    callerAppId: params.identity.appId,
    tenantId: params.tenantId,
    isoTimestamp: iso,
    bodySha256: bodySha,
  });
  const privateKey = crypto.createPrivateKey(params.identity.privateKeyPem);
  const sig = crypto
    .sign(null, Buffer.from(canonical), privateKey)
    .toString('base64');
  return {
    'x-anby-app': params.identity.appId,
    'x-anby-timestamp': iso,
    'x-anby-body-sha256': bodySha,
    'x-anby-signature': sig,
  };
}

/**
 * Verifier side: check a signature against a known public key. The caller
 * MUST supply the public key it has on file for the claimed appId — the
 * verifier does not look up keys. `claimedAppId` is untrusted until this
 * function returns true.
 *
 * Returns `{ok: true}` only when the signature is valid, the timestamp is
 * within tolerance, and the body hash matches the one that was signed.
 */
export function verifyAppRequest(params: {
  claimedAppId: string;
  tenantId: string;
  publicKeyPem: string;
  headers: Record<string, string | string[] | undefined>;
  bodyRaw: string | Buffer;
  now?: Date;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const h = (k: string): string | undefined => {
    const v = params.headers[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const appHeader = h('x-anby-app');
  const iso = h('x-anby-timestamp');
  const bodySha = h('x-anby-body-sha256');
  const signature = h('x-anby-signature');
  if (!appHeader || !iso || !bodySha || !signature) {
    return { ok: false, reason: 'missing signature headers' };
  }
  if (appHeader !== params.claimedAppId) {
    return { ok: false, reason: 'header app id does not match claimed id' };
  }
  const now = params.now ?? new Date();
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  const tol = (params.toleranceSeconds ?? 300) * 1000;
  if (Math.abs(now.getTime() - ts) > tol) {
    return { ok: false, reason: 'timestamp outside tolerance window' };
  }
  const expectedBodyHash = hashBody(params.bodyRaw);
  if (
    !crypto.timingSafeEqual(
      Buffer.from(bodySha),
      Buffer.from(expectedBodyHash),
    )
  ) {
    return { ok: false, reason: 'body hash mismatch' };
  }
  const canonical = canonicalSigString({
    callerAppId: params.claimedAppId,
    tenantId: params.tenantId,
    isoTimestamp: iso,
    bodySha256: bodySha,
  });
  try {
    const publicKey = crypto.createPublicKey(params.publicKeyPem);
    const ok = crypto.verify(
      null,
      Buffer.from(canonical),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch (err) {
    return {
      ok: false,
      reason: 'verify error: ' + (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Consumer-side identity config (loads private key from env once)
// ---------------------------------------------------------------------------

let _identity: AppIdentity | null = null;

export function configureAppIdentity(identity: AppIdentity): void {
  _identity = identity;
}

export function getAppIdentity(): AppIdentity {
  if (_identity) return _identity;
  const appId = process.env.APP_ID;
  const rawKey = process.env.APP_PRIVATE_KEY;
  if (!appId || !rawKey) {
    throw new Error(
      'App identity not configured. Set APP_ID + APP_PRIVATE_KEY env vars, ' +
        'or call configureAppIdentity().',
    );
  }
  // .env files often store multi-line PEMs with literal `\n` escapes so the
  // value survives a single line. Restore real newlines before passing to
  // node crypto, which expects PEM with embedded LF.
  const privateKeyPem = rawKey.includes('\\n')
    ? rawKey.replace(/\\n/g, '\n')
    : rawKey;
  _identity = { appId, privateKeyPem };
  return _identity;
}

/** For tests. */
export function _resetAppIdentity(): void {
  _identity = null;
}
