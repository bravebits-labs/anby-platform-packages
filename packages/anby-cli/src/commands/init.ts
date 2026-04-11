import { writeFile, readFile, access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import kleur from 'kleur';
import { getStoredAuth, getEmailDomain } from '../lib/auth-store.js';
import { assembleToken } from '../lib/token.js';

const DEFAULT_REGISTRY_URL = 'https://registry.anby.ai';

interface InitOptions {
  /** Hidden override for platform devs */
  registryUrl?: string;
}

/**
 * `anby init` — interactive scaffold + register.
 *
 * Prompts for app name and port, auto-generates a reverse-domain ID
 * from the logged-in user's email domain, scaffolds all platform
 * integration code, and registers with the registry.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Collect inputs interactively ────────────────────────────────
    const name = (await rl.question(kleur.bold('App name: '))).trim();
    if (!name) {
      console.log(kleur.red('✖ App name is required'));
      return;
    }

    const portInput = (await rl.question(kleur.bold(`Port (default 3099): `))).trim();
    const port = portInput ? Number.parseInt(portInput, 10) : 3099;
    if (Number.isNaN(port)) {
      console.log(kleur.red('✖ Invalid port'));
      return;
    }

    // ── Auto-generate app ID ────────────────────────────────────────
    const auth = await getStoredAuth();
    const emailDomain = auth ? getEmailDomain(auth.email) : 'example.com';

    // "bravebits.vn" → "vn.bravebits"
    const reverseDomain = emailDomain.split('.').reverse().join('.');
    // "Organization Chart" → "organization-chart"
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let id = `${reverseDomain}.${slug}`;

    // Check if ID already exists in registry, append suffix if so
    const registryBase = (
      options.registryUrl ||
      process.env.ANBY_REGISTRY_URL ||
      DEFAULT_REGISTRY_URL
    ).replace(/\/+$/, '');

    const existingId = await checkAppExists(registryBase, id);
    if (existingId) {
      // Append a short random suffix
      const suffix = Math.random().toString(36).slice(2, 6);
      id = `${reverseDomain}.${slug}-${suffix}`;
      console.log(
        kleur.dim(`  App ID "${reverseDomain}.${slug}" already taken → using ${id}`),
      );
    }

    console.log(kleur.dim(`  App ID: ${id}`));
    console.log('');

    // ── Scaffold ────────────────────────────────────────────────────
    await writeManifest({ id, name, port });
    await patchViteConfig();
    await patchGitignore();
    await scaffoldAuthServer();
    await patchEntryServer(port);
    await registerAndWriteToken({ id, name, port, registryBase, auth });

    console.log('');
    console.log(kleur.green('✔ Anby app bootstrap complete'));
    console.log('');
    console.log(kleur.bold('Next steps:'));
    console.log(kleur.dim(`  1. Edit ${kleur.cyan('anby-app.manifest.json')} to declare provides/requires`));
    console.log(kleur.dim(`     (entities your app shares with or consumes from other apps)`));
    console.log(kleur.dim(`  2. ${kleur.cyan('npm run dev')} — app auto-publishes manifest to registry on boot`));
    console.log(kleur.dim(`  3. Install via Marketplace UI at ${kleur.cyan(`http://localhost:${port}`)}`));
  } finally {
    rl.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function checkAppExists(registryBase: string, appId: string): Promise<boolean> {
  try {
    const res = await fetch(`${registryBase}/registry/apps/${appId}/manifest`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    // Registry unreachable — assume not taken
    return false;
  }
}

// ── Step 1: Manifest ──────────────────────────────────────────────────

async function writeManifest(opts: {
  id: string;
  name: string;
  port: number;
}): Promise<void> {
  const target = resolve('anby-app.manifest.json');

  try {
    await access(target);
    console.log(
      kleur.dim(`• ${target} already exists — leaving it alone`),
    );
    return;
  } catch {
    // ok — file doesn't exist
  }

  const manifest = {
    $schema: 'https://anby.dev/schemas/app-manifest.v1.json',
    id: opts.id,
    version: '1.0.0',
    name: opts.name,
    description: `${opts.name} — submitted via @anby/cli`,
    icon: '📦',
    color: '#E63426',
    runtime: {
      type: 'remix',
      port: opts.port,
      healthCheck: '/api/health',
      readyCheck: '/api/health',
    },
    frontend: {
      type: 'iframe',
      routes: [{ path: '/', label: opts.name, icon: '📦' }],
      navPosition: 'sidebar',
    },
    provides: { entities: [], events: [] },
    requires: {
      platform: ['auth'],
      entities: [],
      events: [],
      optional: { entities: [], events: [] },
    },
    permissions: ['write:own-data'],
    database: { type: 'postgresql' },
  };

  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(kleur.green(`✔ Wrote anby-app.manifest.json`));
}

// ── Step 2: Vite config ───────────────────────────────────────────────

async function patchViteConfig(): Promise<void> {
  const candidates = [
    'vite.config.ts',
    'vite.config.mts',
    'vite.config.js',
    'vite.config.mjs',
  ];
  let target: string | null = null;
  for (const name of candidates) {
    try {
      await access(resolve(name));
      target = name;
      break;
    } catch {
      // try next
    }
  }
  if (!target) {
    console.log(
      kleur.dim(
        '• No vite.config.* found — skipping plugin wiring. Add `anbyVitePlugin()` from `@anby/platform-sdk/vite` to your bundler manually.',
      ),
    );
    return;
  }

  const path = resolve(target);
  const original = await readFile(path, 'utf-8');

  if (original.includes('anbyVitePlugin')) {
    console.log(
      kleur.dim(`• ${target} already wires anbyVitePlugin — no patch needed`),
    );
    return;
  }

  const importLine =
    "import { anbyVitePlugin } from '@anby/platform-sdk/vite';";

  const importRegex = /^import .+ from .+;?\s*$/gm;
  let lastImportEnd = -1;
  for (const match of original.matchAll(importRegex)) {
    if (match.index !== undefined) {
      lastImportEnd = match.index + match[0].length;
    }
  }

  let withImport: string;
  if (lastImportEnd >= 0) {
    withImport =
      original.slice(0, lastImportEnd) +
      '\n' +
      importLine +
      original.slice(lastImportEnd);
  } else {
    withImport = importLine + '\n' + original;
  }

  const pluginsArrayRegex = /(plugins\s*:\s*\[)(\s*)/;
  if (!pluginsArrayRegex.test(withImport)) {
    console.log(
      kleur.yellow(
        `! Could not find a \`plugins: [...]\` array in ${target}. ` +
          `Add ${kleur.cyan('anbyVitePlugin()')} to your plugins manually.`,
      ),
    );
    return;
  }

  const patched = withImport.replace(
    pluginsArrayRegex,
    (_, head: string, ws: string) => `${head}${ws}anbyVitePlugin(),${ws}`,
  );

  await writeFile(path, patched, 'utf-8');
  console.log(kleur.green(`✔ Patched ${target} to load anbyVitePlugin`));
}

// ── Step 3: .gitignore ────────────────────────────────────────────────

async function patchGitignore(): Promise<void> {
  const path = resolve('.gitignore');
  let existing = '';
  try {
    existing = await readFile(path, 'utf-8');
  } catch {
    // file doesn't exist — we'll create it below
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  const needsPublicAnby = !lines.some(
    (l) => l === 'public/_anby/' || l === 'public/_anby',
  );
  const needsDotAnby = !lines.some(
    (l) => l === '.anby/' || l === '.anby',
  );

  if (!needsPublicAnby && !needsDotAnby) {
    console.log(
      kleur.dim('• .gitignore already covers Anby paths — no change'),
    );
    return;
  }

  let block = '';
  if (needsPublicAnby || needsDotAnby) {
    block +=
      (existing.length === 0 || existing.endsWith('\n') ? '' : '\n') +
      '\n# Anby — auto-generated files (do not commit)\n';
    if (needsPublicAnby) block += 'public/_anby/\n';
    if (needsDotAnby) block += '.anby/\n';
  }

  await writeFile(path, existing + block, 'utf-8');
  console.log(kleur.green('✔ Updated .gitignore for Anby paths'));
}

// ── Step 4: auth.server.ts scaffold ───────────────────────────────────

const AUTH_SERVER_TEMPLATE = `/**
 * Auth utilities — auto-generated by \`anby init\`.
 *
 * Uses @anby/platform-sdk for authentication.
 * Supports RS256 JWT (browser/Bearer/cookie) + HMAC (service-to-service).
 * Extracts tenantId from JWT payload.
 */

import {
  bootstrapFromToken,
  authenticateRequest as sdkAuthenticate,
  requireAuth as sdkRequireAuth,
  type AuthUser,
} from '@anby/platform-sdk';

const ANBY_APP_TOKEN = process.env.ANBY_APP_TOKEN || '';

if (!ANBY_APP_TOKEN) {
  throw new Error(
    'ANBY_APP_TOKEN is required. Run \\\`anby login && anby init\\\` to generate one.',
  );
}

let _bootstrapPromise: Promise<void> | null = null;

/**
 * Initialize the SDK by bootstrapping from ANBY_APP_TOKEN. Returns a
 * promise that resolves when discovery + auth public key are fetched
 * and the SDK is ready to verify tokens. Idempotent.
 */
export function initAuth(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = bootstrapFromToken({ appToken: ANBY_APP_TOKEN }).catch(
    (err) => {
      _bootstrapPromise = null;
      throw err;
    },
  );
  return _bootstrapPromise;
}

// Kick off bootstrap at module load.
initAuth().catch((err) => {
  console.error('[anby] bootstrap failed at module load:', err);
});

export type { AuthUser };

/**
 * Authenticate a request via JWT or HMAC.
 * Returns the authenticated user with tenantId or null.
 */
export function authenticateRequest(request: Request): AuthUser | null {
  return sdkAuthenticate(request);
}

/**
 * Require authentication — throws 401 if not authenticated.
 */
export function requireAuth(request: Request): AuthUser {
  return sdkRequireAuth(request);
}

/**
 * Extract tenantId from the authenticated user.
 * Falls back to 'default' if not present.
 */
export function getTenantId(request: Request): string {
  const user = authenticateRequest(request);
  return user?.tenantId || 'default';
}
`;

async function scaffoldAuthServer(): Promise<void> {
  const appDir = resolve('app');
  try {
    await access(appDir);
  } catch {
    console.log(
      kleur.dim(
        '• No app/ directory found (not a Remix project?) — skipping auth.server.ts scaffold',
      ),
    );
    return;
  }

  const libDir = resolve('app/lib');
  const target = resolve('app/lib/auth.server.ts');

  try {
    await access(target);
    console.log(
      kleur.dim(`• app/lib/auth.server.ts already exists — leaving it alone`),
    );
    return;
  } catch {
    // ok — file doesn't exist, we'll create it
  }

  await mkdir(libDir, { recursive: true });
  await writeFile(target, AUTH_SERVER_TEMPLATE, 'utf-8');
  console.log(kleur.green('✔ Scaffolded app/lib/auth.server.ts'));
}

// ── Step 5: Patch entry.server.tsx ────────────────────────────────────

async function patchEntryServer(port: number): Promise<void> {
  const target = resolve('app/entry.server.tsx');
  let original: string;
  try {
    original = await readFile(target, 'utf-8');
  } catch {
    console.log(
      kleur.dim(
        '• No app/entry.server.tsx found — skipping entry patch.',
      ),
    );
    return;
  }

  if (original.includes('initAuth')) {
    console.log(
      kleur.dim('• app/entry.server.tsx already has initAuth — no patch needed'),
    );
    return;
  }

  const sdkImport = "import { autoPublishOnBoot } from '@anby/platform-sdk';";
  const authImport = "import { initAuth } from './lib/auth.server';";

  const importRegex = /^import .+ from .+;?\s*$/gm;
  let lastImportEnd = -1;
  for (const match of original.matchAll(importRegex)) {
    if (match.index !== undefined) {
      lastImportEnd = match.index + match[0].length;
    }
  }

  let withImports: string;
  if (lastImportEnd >= 0) {
    withImports =
      original.slice(0, lastImportEnd) +
      '\n' +
      sdkImport +
      '\n' +
      authImport +
      original.slice(lastImportEnd);
  } else {
    withImports = sdkImport + '\n' + authImport + '\n' + original;
  }

  const bootstrapBlock = `
// Anby platform bootstrap — auto-generated by \`anby init\`.
// Ensures auth + discovery are ready before the first request.
await initAuth();
autoPublishOnBoot({
  publicUrl: process.env.APP_PUBLIC_URL || \`http://localhost:\${process.env.PORT || ${port}}\`,
});
`;

  const exportRegex = /^export\s+(default|function|async\s+function)/m;
  const exportMatch = withImports.match(exportRegex);
  let patched: string;
  if (exportMatch && exportMatch.index !== undefined) {
    patched =
      withImports.slice(0, exportMatch.index) +
      bootstrapBlock +
      '\n' +
      withImports.slice(exportMatch.index);
  } else {
    patched = withImports + '\n' + bootstrapBlock;
  }

  await writeFile(target, patched, 'utf-8');
  console.log(kleur.green('✔ Patched app/entry.server.tsx (initAuth + autoPublishOnBoot)'));
}

// ── Step 6: Self-register with registry ───────────────────────────────

async function registerAndWriteToken(opts: {
  id: string;
  name: string;
  port: number;
  registryBase: string;
  auth: { token: string; email: string } | null;
}): Promise<void> {
  if (!opts.auth) {
    console.log(
      kleur.yellow(
        '! Not logged in — run `anby login` first, then `anby init` again',
      ),
    );
    return;
  }

  // Check if .env already has a non-empty ANBY_APP_TOKEN
  const envPath = resolve('.env');
  try {
    const envContent = await readFile(envPath, 'utf-8');
    const match = envContent.match(/^ANBY_APP_TOKEN=(.*)$/m);
    if (match && match[1].trim()) {
      console.log(
        kleur.dim('• .env already contains ANBY_APP_TOKEN — skipping registration'),
      );
      return;
    }
  } catch {
    // .env doesn't exist — fine, we'll create it
  }

  // Load the manifest we just wrote
  let manifest;
  try {
    const raw = await readFile(resolve('anby-app.manifest.json'), 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    console.log(
      kleur.yellow('! Could not read anby-app.manifest.json — skipping registration'),
    );
    return;
  }

  const publicUrl = `http://localhost:${opts.port}`;
  const registryUrl = `${opts.registryBase}/registry/apps`;

  // Register with a minimal manifest (just metadata, no entities).
  // Entity declarations are published later by autoPublishOnBoot when
  // the developer runs `npm run dev` — by then they've had time to
  // edit the manifest with the correct provides/requires.
  const registrationManifest = {
    ...manifest,
    provides: { entities: [], events: [] },
    requires: { ...manifest.requires, entities: [], events: [] },
  };

  const body = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    color: manifest.color,
    publisherId: manifest.id.split('.').slice(0, 2).join('.'),
    version: manifest.version,
    publicUrl,
    submittedBy: `cli:${opts.auth.email}`,
    manifest: registrationManifest,
  };

  let res: Response;
  try {
    res = await fetch(registryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.auth.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.log(
      kleur.yellow(
        `! Could not reach registry at ${registryUrl}: ${(err as Error).message}`,
      ),
    );
    return;
  }

  if (!res.ok) {
    const errBody = await res.text();
    console.log(
      kleur.yellow(`! Registry rejected publish (${res.status}): ${errBody}`),
    );
    return;
  }

  const result = await res.json();

  if (!result.privateKey) {
    console.log(
      kleur.dim(
        '• App already registered (no new private key). Run `anby app rotate-token` for a new token.',
      ),
    );
    return;
  }

  // Assemble token — platformUrl is the registry base (used by SDK discovery)
  const token = assembleToken({
    appId: manifest.id,
    platformUrl: opts.registryBase,
    privateKey: result.privateKey,
  });

  // Upsert into .env: replace existing ANBY_APP_TOKEN/APP_PUBLIC_URL
  // lines if present, otherwise append.
  let envContent = '';
  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist — start fresh
  }

  envContent = upsertEnvVar(envContent, 'ANBY_APP_TOKEN', token);
  envContent = upsertEnvVar(
    envContent,
    'APP_PUBLIC_URL',
    `http://localhost:${opts.port}`,
  );

  await writeFile(envPath, envContent, { mode: 0o600 });
  console.log(kleur.green('✔ Registered app with registry'));
  console.log(kleur.green('✔ Wrote ANBY_APP_TOKEN to .env'));
}

/**
 * Upsert an env var into a .env file content string.
 * If the key exists (with or without value), replace the line.
 * Otherwise append to the end.
 */
function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  // Append, ensuring file ends with newline
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return content + sep + line + '\n';
}
