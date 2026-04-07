import kleur from 'kleur';

interface ListOptions {
  tenant?: string;
  registry: string;
}

interface MarketplaceEntry {
  id: string;
  name: string;
  latestVersion: string | null;
  publicUrl?: string | null;
  featured?: boolean;
  status?: string;
}

interface InstalledEntry {
  id: string;
  name: string;
  publicUrl?: string | null;
  status: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const url = options.tenant
    ? `${options.registry}/registry/tenants/${options.tenant}/apps`
    : `${options.registry}/registry/marketplace`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(kleur.red(`✖ Request failed (${res.status})`));
    process.exit(1);
  }

  const data = (await res.json()) as MarketplaceEntry[] | InstalledEntry[];
  if (!data.length) {
    console.log(kleur.dim('(no apps)'));
    return;
  }

  for (const entry of data) {
    const label = options.tenant
      ? `${kleur.bold(entry.id)}  ${entry.name}  [${(entry as InstalledEntry).status}]`
      : `${kleur.bold(entry.id)}@${(entry as MarketplaceEntry).latestVersion ?? '?'}  ${entry.name}${(entry as MarketplaceEntry).featured ? kleur.yellow(' ★') : ''}`;
    console.log(label);
    if (entry.publicUrl) {
      console.log(kleur.dim(`  ${entry.publicUrl}`));
    }
  }
}
