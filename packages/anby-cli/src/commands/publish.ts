import kleur from 'kleur';
import { publishAppFromManifest } from '@anby/platform-sdk';

interface PublishOptions {
  manifest: string;
  registry: string;
  publicUrl?: string;
  changelog?: string;
  featured?: boolean;
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
}
