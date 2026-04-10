import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ANBY_DIR = join(homedir(), '.anby');
const AUTH_FILE = join(ANBY_DIR, 'auth.json');

export interface StoredAuth {
  token: string;
  email: string;
  expiresAt: string; // ISO 8601
}

/**
 * Read stored CLI credentials from ~/.anby/auth.json.
 * Returns null if the file doesn't exist or the token has expired.
 */
export async function getStoredAuth(): Promise<StoredAuth | null> {
  try {
    const raw = await readFile(AUTH_FILE, 'utf-8');
    const data = JSON.parse(raw) as StoredAuth;
    if (!data.token) return null;
    if (new Date(data.expiresAt) < new Date()) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Persist CLI credentials to ~/.anby/auth.json (0600).
 */
export async function saveAuth(auth: StoredAuth): Promise<void> {
  await mkdir(ANBY_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2) + '\n', {
    mode: 0o600,
  });
}

/**
 * Remove stored credentials.
 */
export async function clearAuth(): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(AUTH_FILE);
  } catch {
    // Already gone — fine.
  }
}

/**
 * Extract email domain from stored auth.
 * e.g. "user@bravebits.vn" → "bravebits.vn"
 */
export function getEmailDomain(email: string): string {
  const parts = email.split('@');
  return parts[1] || 'example.com';
}
