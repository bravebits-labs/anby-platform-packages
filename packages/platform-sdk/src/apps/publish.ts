/**
 * App publish helper for self-hosted Anby services.
 *
 * Single code path used by:
 *   - Service startup (`publishAppFromManifest()` inside entry.server.tsx / main.ts)
 *   - The `anby app publish` CLI
 *   - The shell's Marketplace "Submit app" server action
 *
 * All three converge on `POST /registry/apps` with a platform HMAC signature,
 * which the registry verifies via `HmacGuard` and then persists via the same
 * `registry.service.publishApp()`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { validateManifest, type AppManifest } from '@anby/manifest-schema';
import { signHmac } from '../auth/index.js';
import { schemaChecksum } from '../entities/schema.js';

export interface PublishAppOptions {
  /**
   * Path to the manifest file. Defaults to `./anby-app.manifest.json` in the
   * current working directory, which is where every Anby service keeps it.
   */
  manifestPath?: string;
  /**
   * Registry base URL — defaults to REGISTRY_URL env or http://localhost:3003.
   */
  registryUrl?: string;
  /**
   * Public URL where this service is reachable. Overrides APP_PUBLIC_URL env.
   * When neither is set, the helper derives `http://localhost:<manifest.runtime.port>`.
   */
  publicUrl?: string;
  /**
   * HMAC secret used to authenticate the call. Defaults to INTERNAL_API_SECRET
   * env. Must match the secret the registry is running with.
   */
  internalApiSecret?: string;
  /**
   * Identifier sent in `x-internal-user` header. Defaults to the manifest id
   * so audit logs show which service published.
   */
  submittedBy?: string;
  /**
   * Marks the app as "featured" so it shows up in the setup-wizard
   * recommendation list. Defaults to false.
   */
  featured?: boolean;
  /**
   * Optional changelog string attached to this version.
   */
  changelog?: string;
  /**
   * If true, swallow network/registry errors and return null instead of
   * throwing. Used by `autoPublishOnBoot` so a flaky registry doesn't
   * crash the service startup.
   */
  silent?: boolean;
}

export interface PublishAppResult {
  app: {
    id: string;
    name: string;
    publicUrl: string | null;
    status: string;
  };
  version: { appId: string; version: string };
  /**
   * Ed25519 private key (PEM) returned ONCE on first publish. Used to
   * assemble the ANBY_APP_TOKEN connection string for the developer to
   * paste into their app's env. Null on subsequent publishes — the
   * registry never re-returns the key.
   *
   * The CLI uses this to print the assembled token. Programmatic
   * callers should treat this field as a secret and avoid logging it.
   */
  privateKey: string | null;
}

async function loadManifest(path: string): Promise<AppManifest> {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as AppManifest;
  const { valid, errors } = validateManifest(parsed);
  if (!valid) {
    throw new Error(
      `Manifest at ${path} is invalid:\n  - ${errors.join('\n  - ')}`,
    );
  }
  return parsed;
}

/**
 * Public helper: load the manifest from disk and return it with all
 * `provides.entities[].schema` paths resolved to inlined JSON content.
 *
 * Used both internally by `publishAppFromManifest` and by services that
 * want to expose the wire-format manifest over HTTP (e.g. a Remix route
 * at `/_anby/manifest`) so the Marketplace submit form can fetch it
 * without requiring the publisher to paste anything by hand.
 */
export async function getInlinedManifest(
  opts: { manifestPath?: string } = {},
): Promise<AppManifest> {
  const manifestPath = resolve(
    opts.manifestPath ?? join(process.cwd(), 'anby-app.manifest.json'),
  );
  const raw = await loadManifest(manifestPath);
  return inlineEntitySchemas(raw, manifestPath);
}

/**
 * Entity schema inliner (CR-4).
 *
 * The manifest-on-disk references schemas by relative path for
 * developer ergonomics. At publish time we MUST inline the actual JSON
 * content — the registry has no access to the publisher's filesystem
 * and explicitly rejects string schema paths in publish payloads.
 *
 * We also compute a sha256 checksum over the schema content so the
 * registry can detect drift in follow-up publishes.
 */
async function inlineEntitySchemas(
  manifest: AppManifest,
  manifestPath: string,
): Promise<AppManifest> {
  const entities = manifest.provides?.entities;
  if (!entities || entities.length === 0) return manifest;

  const manifestDir = dirname(manifestPath);
  const resolved = await Promise.all(
    entities.map(async (entry) => {
      // String form — legacy. Coerce to object with no schema.
      if (typeof entry === 'string') {
        return { name: entry, version: 'v1' };
      }
      // Object form without a schema field — nothing to inline.
      if (!entry.schema) return entry;
      // Already inlined (object content, not a path) — pass through and
      // compute checksum if the caller didn't.
      if (typeof entry.schema === 'object') {
        return {
          ...entry,
          schemaChecksum: entry.schemaChecksum ?? schemaChecksum(entry.schema),
        };
      }
      // Schema is a string path — resolve relative to the manifest,
      // read, parse, inline.
      const schemaPath = isAbsolute(entry.schema)
        ? entry.schema
        : resolve(manifestDir, entry.schema);
      let rawSchema: string;
      try {
        rawSchema = await readFile(schemaPath, 'utf-8');
      } catch (err) {
        throw new Error(
          `Entity "${entry.name}": unable to read schema file at ${schemaPath} ` +
            `(${(err as Error).message})`,
        );
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawSchema);
      } catch (err) {
        throw new Error(
          `Entity "${entry.name}": schema file at ${schemaPath} is not valid JSON: ${(err as Error).message}`,
        );
      }
      return {
        name: entry.name,
        version: entry.version,
        schema: parsed,
        schemaChecksum: schemaChecksum(parsed),
      };
    }),
  );

  return {
    ...manifest,
    provides: {
      ...manifest.provides,
      entities: resolved,
    },
  };
}

export async function publishAppFromManifest(
  opts: PublishAppOptions = {},
): Promise<PublishAppResult | null> {
  try {
    const manifestPath = resolve(
      opts.manifestPath ?? join(process.cwd(), 'anby-app.manifest.json'),
    );
    // CR-4: inline schema content before sending. Manifest on disk uses
    // relative paths for DX; wire format sends the actual JSON object.
    const manifest = await getInlinedManifest({ manifestPath });

    const publicUrl =
      opts.publicUrl ??
      process.env.APP_PUBLIC_URL ??
      `http://localhost:${manifest.runtime.port}`;

    // PLAN-app-bootstrap-phase2 PR4: prefer the registry URL discovered
    // by bootstrapFromToken. Falls back to the explicit option, then env,
    // then localhost. The discovered value is the registry HOST root
    // (no /registry suffix), so this code can append /registry/apps below.
    let registryUrl = opts.registryUrl ?? process.env.REGISTRY_URL;
    if (!registryUrl) {
      try {
        // Lazy require to avoid a circular import at module load time.
        const { getDiscoveredRegistryBaseUrl } = await import('../bootstrap/index.js');
        registryUrl = await getDiscoveredRegistryBaseUrl();
      } catch {
        // bootstrap not started yet — fall back to localhost dev default.
        registryUrl = 'http://localhost:3003';
      }
    }

    const internalApiSecret =
      opts.internalApiSecret ?? process.env.INTERNAL_API_SECRET ?? '';
    if (!internalApiSecret) {
      throw new Error(
        'INTERNAL_API_SECRET is not set — cannot sign publish request',
      );
    }

    const submittedBy = opts.submittedBy ?? manifest.id;
    const signature = signHmac(submittedBy, internalApiSecret);

    const body = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon,
      color: manifest.color,
      publisherId: manifest.id.split('.').slice(0, 2).join('.'),
      version: manifest.version,
      publicUrl,
      submittedBy,
      featured: opts.featured,
      changelog: opts.changelog,
      manifest,
    };

    const res = await fetch(`${registryUrl}/registry/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-user': submittedBy,
        'x-internal-signature': signature,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Registry rejected publish (${res.status}): ${errBody}`,
      );
    }

    const result = (await res.json()) as PublishAppResult;
    console.log(
      `[platform-sdk] Published ${manifest.id}@${manifest.version} to ${registryUrl} (publicUrl=${publicUrl})`,
    );
    return result;
  } catch (err) {
    if (opts.silent) {
      console.warn(
        `[platform-sdk] publishAppFromManifest failed (silent): ${(err as Error).message}`,
      );
      return null;
    }
    throw err;
  }
}

/**
 * Fire-and-forget wrapper for use inside service entrypoints. Logs on both
 * success and failure but never throws, so a flaky registry at boot time
 * doesn't crash the service.
 */
export function autoPublishOnBoot(opts: PublishAppOptions = {}): void {
  publishAppFromManifest({ ...opts, silent: true }).catch((err) => {
    console.warn(
      `[platform-sdk] autoPublishOnBoot unexpected error: ${(err as Error).message}`,
    );
  });
}
