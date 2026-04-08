import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import kleur from 'kleur';

interface InitOptions {
  id?: string;
  name?: string;
  port?: string;
}

/**
 * One-stop project bootstrap for an Anby app.
 *
 * Run once after `npm create remix` (or any Vite-based stack):
 *
 *   1. Writes `anby-app.manifest.json` skeleton
 *   2. Patches `vite.config.ts` to load `anbyVitePlugin()` from
 *      `@anby/platform-sdk/vite` (idempotent — skips if already wired)
 *   3. Adds `public/_anby/` to `.gitignore`
 *
 * After this single command the app is ready for the Marketplace
 * Submit-app form: every dev/build run regenerates
 * `public/_anby/manifest.json`, which the marketplace shell fetches
 * directly. The publisher never edits any code by hand.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  await writeManifest(options);
  await patchViteConfig();
  await patchGitignore();

  const port = Number.parseInt(options.port ?? '3099', 10);
  console.log('');
  console.log(kleur.green('✔ Anby app bootstrap complete'));
  console.log(
    kleur.dim(
      `  Next: npm run dev — then submit ${kleur.cyan(`http://localhost:${port}`)} via the Marketplace UI`,
    ),
  );
}

async function writeManifest(options: InitOptions): Promise<void> {
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

  const id = options.id ?? 'com.example.my-app';
  const name = options.name ?? 'My App';
  const port = Number.parseInt(options.port ?? '3099', 10);

  const manifest = {
    $schema: 'https://anby.dev/schemas/app-manifest.v1.json',
    id,
    version: '1.0.0',
    name,
    description: `${name} — submitted via @anby/cli`,
    icon: '📦',
    color: '#E63426',
    runtime: {
      type: 'remix',
      port,
      healthCheck: '/api/health',
      readyCheck: '/api/health',
    },
    frontend: {
      type: 'iframe',
      routes: [{ path: '/', label: name, icon: '📦' }],
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
  console.log(kleur.green(`✔ Wrote ${target}`));
}

/**
 * Idempotently patch `vite.config.ts` (or `.js`/`.mts`/`.mjs`) to load
 * `anbyVitePlugin()`. The patch is a deliberately small textual edit:
 * we add the import line near the existing imports and inject
 * `anbyVitePlugin(),` as the first entry of the `plugins: [` array.
 *
 * If the file is too unusual to patch safely (no `plugins: [` literal),
 * we print a clear instruction for the publisher to add the lines by
 * hand. Either way the manifest skeleton has already been written, so
 * the command stays useful even when the patch fails.
 */
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

  // Insert the import after the last existing top-level `import ... from`
  // line so we don't accidentally split a multi-line import statement.
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

  // Inject `anbyVitePlugin(),` as the first item of the `plugins: [` array.
  // We match `plugins:` followed by `[` and any whitespace, and insert
  // right after the `[`. Idempotency is enforced by the earlier
  // `includes('anbyVitePlugin')` check above.
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

/**
 * Append `public/_anby/` to `.gitignore` so the auto-generated wire
 * manifest doesn't pollute commits. Idempotent — does nothing if the
 * line is already present, and creates the file if missing.
 */
async function patchGitignore(): Promise<void> {
  const path = resolve('.gitignore');
  const line = 'public/_anby/';
  let existing = '';
  try {
    existing = await readFile(path, 'utf-8');
  } catch {
    // file doesn't exist — we'll create it below
  }

  // Match either `public/_anby/` or `public/_anby` on its own line, with
  // optional trailing slash and surrounding whitespace.
  const alreadyIgnored = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === line || l === 'public/_anby');
  if (alreadyIgnored) {
    console.log(
      kleur.dim('• .gitignore already covers public/_anby/ — no change'),
    );
    return;
  }

  const block =
    (existing.length === 0 || existing.endsWith('\n') ? '' : '\n') +
    '\n# Anby — auto-generated wire manifest (do not commit)\n' +
    line +
    '\n';
  await writeFile(path, existing + block, 'utf-8');
  console.log(kleur.green('✔ Added public/_anby/ to .gitignore'));
}
