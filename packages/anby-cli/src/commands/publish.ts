import kleur from 'kleur';
import { writeFile } from 'node:fs/promises';
import { publishAppFromManifest } from '@anby/platform-sdk';
import { assembleToken } from '../lib/token.js';

interface PublishOptions {
  manifest: string;
  registry: string;
  publicUrl?: string;
  changelog?: string;
  featured?: boolean;
  /**
   * If set, the CLI writes the assembled ANBY_APP_TOKEN to this path
   * (e.g. ".env.local"). Without this flag the token is only printed
   * to stdout — the dev is responsible for capturing it.
   */
  saveTo?: string;
  /**
   * Override the platform base URL embedded in the token. Defaults to
   * the registry URL with the /registry suffix stripped.
   */
  platformUrl?: string;
}

export async function publishCommand(options: PublishOptions): Promise<void> {
  const result = await publishAppFromManifest({
    manifestPath: options.manifest,
    registryUrl: options.registry,
    publicUrl: options.publicUrl,
    changelog: options.changelog,
    featured: options.featured,
  });

  if (!result) {
    console.error(kleur.red('✖ Publish returned no result'));
    process.exit(1);
  }

  console.log(
    kleur.green(
      `✔ Published ${result.app.id}@${result.version.version} (status=${result.app.status})`,
    ),
  );
  if (result.app.publicUrl) {
    console.log(kleur.dim(`  publicUrl: ${result.app.publicUrl}`));
  }

  // PLAN-app-bootstrap PR3: assemble + print ANBY_APP_TOKEN if the registry
  // returned a fresh private key (only happens on first publish for an app).
  if (result.privateKey) {
    const platformUrl =
      options.platformUrl ?? options.registry.replace(/\/registry\/?$/, '');
    const token = assembleToken({
      appId: result.app.id,
      platformUrl,
      privateKey: result.privateKey,
    });

    console.log('');
    console.log(kleur.bold().yellow('━━━ ANBY_APP_TOKEN (shown ONCE — store it safely) ━━━'));
    console.log('');
    console.log(token);
    console.log('');
    console.log(
      kleur.dim(
        'Paste this into your app environment as ANBY_APP_TOKEN.\n' +
        'It contains your app signing key. Treat it as a secret.\n' +
        'If you lose it, run `anby app rotate-token <appId>` to issue a new one.',
      ),
    );
    console.log(kleur.bold().yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    if (options.saveTo) {
      const envLine = `ANBY_APP_TOKEN=${token}\n`;
      try {
        await writeFile(options.saveTo, envLine, { mode: 0o600 });
        console.log(kleur.green(`✔ Token written to ${options.saveTo}`));
      } catch (err) {
        console.error(
          kleur.red(`✖ Failed to write token to ${options.saveTo}: ${(err as Error).message}`),
        );
        process.exit(1);
      }
    }
  } else {
    console.log(
      kleur.dim(
        '(No new ANBY_APP_TOKEN issued — this app already has a registered keypair.\n' +
        ' To rotate, run `anby app rotate-token ' + result.app.id + '`.)',
      ),
    );
  }
}
