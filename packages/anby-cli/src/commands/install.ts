import kleur from 'kleur';

interface InstallOptions {
  tenant: string;
  app: string;
  registry: string;
}

export async function installCommand(options: InstallOptions): Promise<void> {
  const res = await fetch(
    `${options.registry}/registry/tenants/${options.tenant}/install`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: options.app }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(kleur.red(`✖ Install failed (${res.status}): ${body}`));
    process.exit(1);
  }

  console.log(
    kleur.green(
      `✔ Installed ${options.app} for tenant "${options.tenant}"`,
    ),
  );
}
