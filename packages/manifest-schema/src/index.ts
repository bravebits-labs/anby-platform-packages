// Use the 2020-12 entry point so the schema's `$schema` meta-reference
// resolves. Ajv's default export only bundles draft-07.
import Ajv from 'ajv/dist/2020.js';
import { schema } from './schema.js';

export { schema };

export interface AppManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  runtime: {
    type: 'remix' | 'nestjs' | 'nextjs' | 'docker';
    port: number;
    healthCheck: string;
    readyCheck?: string;
  };
  frontend: {
    type: 'iframe' | 'module-federation';
    /**
     * First-class page definitions. Each `id` MUST be stable across versions
     * because tenant per-page access settings are keyed by `id`. New apps
     * should always use `pages` over `routes`.
     */
    pages?: Array<{
      id: string;
      path: string;
      label: string;
      icon?: string;
      description?: string;
    }>;
    /**
     * Legacy routes. When `pages` is absent, the platform derives page ids
     * from the route path slug. Prefer declaring `pages` explicitly.
     */
    routes?: Array<{
      path: string;
      label: string;
      icon?: string;
      adminOnly?: boolean;
    }>;
    navPosition?: 'sidebar' | 'hidden';
  };
  provides: {
    /**
     * Each entry is either a string (legacy, coerced to { name, version:"v1" })
     * or an object with name, version, and an optional JSON Schema.
     *
     * At manifest-on-disk time, `schema` is a path relative to the manifest.
     * At publish-payload time, the CLI/SDK inlines the schema content into
     * the object so the registry persists actual JSON (see CR-4 in the
     * entity sharing plan).
     */
    entities?: Array<
      | string
      | {
          name: string;
          version?: string;
          schema?: string | Record<string, unknown>;
          schemaChecksum?: string;
        }
    >;
    events?: string[];
    widgets?: Array<{ id: string; label: string; size?: 'sm' | 'md' | 'lg' }>;
  };
  requires: {
    platform?: string[];
    /**
     * Each entry is a qualified entity name. Formats accepted:
     *   "org.period"        → any version (defaults to v1)
     *   "org.period@v1"     → exact version pin
     */
    entities?: string[];
    events?: string[];
    optional?: {
      entities?: string[];
      events?: string[];
    };
  };
  settings?: {
    schema?: Record<string, unknown>;
  };
  permissions: string[];
  database: {
    type: 'postgresql';
    migrationDir?: string;
  };
}

const ajv = new Ajv({ allErrors: true });
const validateFn = ajv.compile(schema);

export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const valid = validateFn(manifest);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors || []).map(e => `${e.instancePath} ${e.message}`);
  return { valid: false, errors };
}

export interface ResolvedPage {
  id: string;
  path: string;
  label: string;
  icon?: string;
  description?: string;
  /** True when the id was auto-derived from a legacy `routes[]` entry. */
  derived: boolean;
}

/**
 * Resolve pages from a manifest, normalising the legacy `routes` shape into
 * the `pages` shape. Callers should always use this instead of reading
 * `frontend.pages` / `frontend.routes` directly so legacy apps keep working.
 */
export function resolveManifestPages(manifest: AppManifest): ResolvedPage[] {
  const fe = manifest.frontend;
  if (fe.pages && fe.pages.length > 0) {
    return fe.pages.map(p => ({
      id: p.id,
      path: p.path,
      label: p.label,
      icon: p.icon,
      description: p.description,
      derived: false,
    }));
  }
  const seen = new Set<string>();
  return (fe.routes ?? []).map(r => {
    let id = deriveLegacyPageId(r.path);
    // Ensure uniqueness within a manifest when multiple routes collapse to
    // the same slug (e.g. "/" and "/index" both → "root").
    let suffix = 2;
    while (seen.has(id)) id = `${deriveLegacyPageId(r.path)}-${suffix++}`;
    seen.add(id);
    return {
      id,
      path: r.path,
      label: r.label,
      icon: r.icon,
      derived: true,
    };
  });
}

function deriveLegacyPageId(path: string): string {
  const slug = path
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'root';
  // Schema pattern requires leading letter.
  return /^[a-z]/.test(slug) ? slug : `p-${slug}`;
}
