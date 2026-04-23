/**
 * App-side token verifier factory.
 *
 * Apps integrate with the platform via `bootstrapFromToken(ANBY_APP_TOKEN)`
 * which loads the registry URL into module state. `createAppVerifier()`
 * uses that bootstrapped state — apps don't need to pass URLs or secrets.
 *
 * Single source of truth for verifying scoped JWTs in app code:
 *
 *   await bootstrapFromToken({ appToken: process.env.ANBY_APP_TOKEN! });
 *   const verifier = await createAppVerifier();
 *   // Use verifier in EntityHandlerRegistration, or call verifier.verify(token).
 *
 * To accept tokens from service apps (e.g. god-brain calling
 * /_anby/god-brain/feed), pass `acceptIssuers`:
 *
 *   const verifier = await createAppVerifier({
 *     acceptIssuers: ['anby-registry', 'vn.bravebits.god-brain'],
 *   });
 *
 * No fallback to INTERNAL_API_SECRET. If the registry public key cannot
 * be fetched, this throws — apps should hard-fail rather than silently
 * fall back to a weaker auth mode.
 */

import { getDiscoveredRegistryBaseUrl } from '../bootstrap/index.js';
import { MultiIssuerVerifier, type TokenVerifier } from './handler.js';

export interface CreateAppVerifierOptions {
  /** Override the registry URL. Defaults to bootstrap-discovered value. */
  registryUrl?: string;
  /** Issuers whose tokens this app accepts. Default: `['anby-registry']`. */
  acceptIssuers?: string[];
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
}

export async function createAppVerifier(
  opts: CreateAppVerifierOptions = {},
): Promise<TokenVerifier> {
  const registryUrl = opts.registryUrl ?? (await getDiscoveredRegistryBaseUrl());
  if (!registryUrl) {
    throw new Error(
      'createAppVerifier: registry URL unavailable — call bootstrapFromToken() first or pass opts.registryUrl',
    );
  }
  const acceptIssuers = opts.acceptIssuers ?? ['anby-registry'];
  const verifier = new MultiIssuerVerifier(
    registryUrl,
    acceptIssuers,
    opts.fetchImpl ?? fetch,
  );
  await verifier.init();
  return verifier;
}
