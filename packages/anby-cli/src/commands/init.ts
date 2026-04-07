import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import kleur from 'kleur';

interface InitOptions {
  id?: string;
  name?: string;
  port?: string;
}

/**
 * Writes an `anby-app.manifest.json` skeleton that passes the AJV
 * schema out of the box. Refuses to overwrite an existing file so a
 * developer can't accidentally clobber their real manifest.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const target = resolve('anby-app.manifest.json');

  try {
    await access(target);
    console.error(
      kleur.red(`✖ ${target} already exists — refusing to overwrite`),
    );
    process.exit(1);
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
  console.log(kleur.dim(`  Next: anby app validate && anby app publish --public-url http://localhost:${port}`));
}
