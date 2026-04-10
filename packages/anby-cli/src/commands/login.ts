import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import kleur from 'kleur';
import { saveAuth, getStoredAuth } from '../lib/auth-store.js';

const DEFAULT_AUTH_URL = 'https://auth.anby.ai';

interface LoginOptions {
  /** Hidden override for platform devs (--auth-url) */
  authUrl?: string;
}

/**
 * `anby login` — authenticate with the Anby platform via Google OAuth.
 *
 * Default auth URL: https://auth.anby.ai
 * Platform devs can override with: anby login --auth-url http://localhost:3000
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const existing = await getStoredAuth();
  if (existing) {
    console.log(
      kleur.dim(`Already logged in as ${existing.email}`),
    );
    console.log(kleur.dim('Run `anby logout` to sign out first.'));
    return;
  }

  const authUrl = (
    options.authUrl ||
    process.env.ANBY_AUTH_URL ||
    DEFAULT_AUTH_URL
  ).replace(/\/+$/, '');

  const { token, email } = await runOAuthFlow(authUrl);

  // JWT exp is 7 days from issuance.
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  );
  const expiresAt = new Date(payload.exp * 1000).toISOString();

  await saveAuth({ token, email: email || payload.email || 'unknown', expiresAt });

  console.log('');
  console.log(kleur.green(`✔ Logged in as ${email || payload.email}`));
  console.log(kleur.dim(`  Token expires: ${expiresAt}`));
}

function runOAuthFlow(authUrl: string): Promise<{ token: string; email: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const email = url.searchParams.get('email') || '';
        const error = url.searchParams.get('error');

        if (error || !token) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorPage(error || 'no_token'));
          server.close();
          reject(new Error(`Login failed: ${error || 'no token received'}`));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(successPage());
        server.close();
        resolve({ token, email });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local server'));
        return;
      }

      const callbackUrl = `http://localhost:${addr.port}/callback`;
      const loginUrl = `${authUrl}/auth/google?returnUrl=${encodeURIComponent(callbackUrl)}&mode=cli`;

      console.log(kleur.dim(`Opening browser for login...`));
      console.log(kleur.dim(`If the browser doesn't open, visit:`));
      console.log(kleur.cyan(loginUrl));
      console.log('');

      openBrowser(loginUrl).catch(() => {
        // Browser didn't open — user can copy the URL above.
      });
    });

    // Timeout after 3 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 3 minutes'));
    }, 180_000);
  });
}

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  const platform = process.platform;
  if (platform === 'darwin') {
    await execAsync(`open "${url}"`);
  } else if (platform === 'win32') {
    await execAsync(`start "" "${url}"`);
  } else {
    await execAsync(`xdg-open "${url}"`);
  }
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Anby CLI</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
<div style="text-align:center">
<h1 style="color:#22c55e">✔ Logged in</h1>
<p>You can close this tab and return to the terminal.</p>
</div></body></html>`;
}

function errorPage(error: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Anby CLI</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
<div style="text-align:center">
<h1 style="color:#ef4444">✖ Login failed</h1>
<p>${error}</p>
<p>Return to the terminal and try again.</p>
</div></body></html>`;
}
