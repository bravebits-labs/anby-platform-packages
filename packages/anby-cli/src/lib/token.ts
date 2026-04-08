/**
 * ANBY_APP_TOKEN assembly helper.
 *
 * Mirrors the parser in @anby/platform-sdk/src/bootstrap. Kept in the CLI
 * (rather than imported from the SDK) so the CLI doesn't have to ship the
 * SDK's whole runtime just for one base64 wrapper.
 *
 * Format: anby_v1_<base64url(json)>
 *   json = { v: 1, appId, platformUrl, privateKey }
 */

export const ANBY_TOKEN_PREFIX = 'anby_v1_';

export interface AssembleTokenInput {
  appId: string;
  platformUrl: string;
  privateKey: string;
}

export function assembleToken(input: AssembleTokenInput): string {
  if (!input.appId || !input.platformUrl || !input.privateKey) {
    throw new Error('assembleToken: appId, platformUrl, and privateKey are required');
  }
  if (!input.privateKey.includes('PRIVATE KEY')) {
    throw new Error('assembleToken: privateKey must be a PEM');
  }
  const payload = {
    v: 1 as const,
    appId: input.appId,
    platformUrl: input.platformUrl.replace(/\/$/, ''),
    privateKey: input.privateKey,
  };
  return ANBY_TOKEN_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
}
