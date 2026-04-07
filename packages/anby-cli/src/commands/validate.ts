import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import kleur from 'kleur';
import { validateManifest } from '@anby/manifest-schema';

interface ValidateOptions {
  manifest: string;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const path = resolve(options.manifest);
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw);
  const { valid, errors } = validateManifest(parsed);

  if (valid) {
    console.log(kleur.green(`✔ ${path} is valid`));
    return;
  }

  console.error(kleur.red(`✖ ${path} is invalid:`));
  for (const err of errors) {
    console.error(kleur.red(`  - ${err}`));
  }
  process.exit(1);
}
