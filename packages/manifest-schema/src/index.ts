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
    routes: Array<{
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
