import kleur from 'kleur';
import { clearAuth } from '../lib/auth-store.js';

export async function logoutCommand(): Promise<void> {
  await clearAuth();
  console.log(kleur.green('✔ Logged out'));
}
