import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CachedBootstrap } from './types.js';

/**
 * Disk cache for the bootstrap discovery response. Used to make cold
 * starts resilient when the platform discovery endpoint is briefly
 * unreachable.
 *
 * Cache is per-app (keyed by appId so multiple apps in the same workdir
 * don't collide). Atomic write via temp file + rename. File mode 0600 so
 * the cache file is owner-only on POSIX systems.
 *
 * Format: JSON. Contains the discovery response and the auth public key
 * PEM. Does NOT contain the per-app private key — that comes from the
 * connection-string token at every boot.
 */

function cacheFilePath(cacheDir: string, appId: string): string {
  // Sanitize appId for filename safety: keep alphanumerics + dashes + dots,
  // replace everything else with underscore.
  const safeId = appId.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  return join(cacheDir, `bootstrap-${safeId}.json`);
}

export async function readCache(
  cacheDir: string,
  appId: string,
): Promise<CachedBootstrap | null> {
  try {
    const path = cacheFilePath(cacheDir, appId);
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as CachedBootstrap;
    if (
      typeof parsed?.fetchedAt !== 'string' ||
      typeof parsed?.staleAt !== 'string' ||
      !parsed?.discovery?.endpoints ||
      typeof parsed?.authPublicKeyPem !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    // ENOENT, parse error, anything — fall back to fresh fetch
    return null;
  }
}

export async function writeCache(
  cacheDir: string,
  appId: string,
  entry: CachedBootstrap,
): Promise<void> {
  const path = cacheFilePath(cacheDir, appId);
  await fs.mkdir(dirname(path), { recursive: true });
  // Atomic write: stage to temp, rename. Rename is atomic on POSIX.
  const tmp = `${path}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}
