/**
 * JSON Schema compilation + validation for entity payloads.
 *
 * Uses Ajv (already pulled in transitively via @anby/manifest-schema). Schemas
 * are compiled once per entity name and cached. Validation is normally on in
 * dev/test and off in production (controlled by NODE_ENV) to avoid CPU cost
 * on the hot path, unless PLATFORM_ENTITY_VALIDATE=1 forces it on.
 */

import crypto from 'crypto';
import { EntitySchemaViolationError } from './errors.js';

type AjvCtor = new (opts?: Record<string, unknown>) => AjvInstance;

interface AjvInstance {
  compile: (schema: Record<string, unknown>) => ValidateFn;
  getSchema?: (key: string) => unknown;
  removeSchema?: (key: string) => unknown;
}

type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

let _ajvInstance: AjvInstance | null = null;
const _validators = new Map<string, ValidateFn>();

async function getAjv(): Promise<AjvInstance> {
  if (_ajvInstance) return _ajvInstance;
  // We use the JSON Schema draft 2020-12 entry point, not the default
  // Ajv export. The default Ajv only ships draft-07, which rejects any
  // schema declaring `$schema: ".../draft/2020-12/schema"` with
  // "no schema with key or ref" — exactly the error our entity provider
  // schemas hit. The 2020 entry point bundles the right meta-schemas.
  // @ts-ignore — ajv is an optional peer dep
  const ajvMod = await import('ajv/dist/2020.js');
  const Ajv = (ajvMod.default ?? ajvMod) as AjvCtor;
  _ajvInstance = new Ajv({ strict: false, allErrors: true });
  return _ajvInstance;
}

function cacheKey(entityName: string, version: string): string {
  return `${entityName}@${version}`;
}

export async function registerEntitySchema(
  entityName: string,
  version: string,
  schema: Record<string, unknown> | null,
): Promise<void> {
  if (!schema) return;
  const key = cacheKey(entityName, version);
  // Already compiled — resolver bootstraps the entity map every 60s and
  // re-registers schemas on each poll, which used to throw "schema with
  // key or id ... already exists" inside Ajv. Skip silently.
  if (_validators.has(key)) return;

  const ajv = await getAjv();
  // Defensive: if a previous compile attempt registered a schema by its
  // `$id` and then errored out before populating `_validators`, the Ajv
  // instance still holds the schema and rejects re-registration. Drop
  // any existing entry before compiling.
  const id = typeof schema.$id === 'string' ? schema.$id : null;
  if (id && ajv.getSchema && ajv.removeSchema && ajv.getSchema(id)) {
    ajv.removeSchema(id);
  }

  const validate = ajv.compile(schema);
  _validators.set(key, validate);
}

function validationEnabled(): boolean {
  if (process.env.PLATFORM_ENTITY_VALIDATE === '1') return true;
  if (process.env.PLATFORM_ENTITY_VALIDATE === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

export function validateEntityPayload(
  entityName: string,
  version: string,
  data: unknown,
): void {
  if (!validationEnabled()) return;
  const validate = _validators.get(cacheKey(entityName, version));
  if (!validate) return; // no schema registered, nothing to check
  const list = Array.isArray(data) ? data : [data];
  for (const item of list) {
    const ok = validate(item);
    if (!ok) {
      const errors = (validate.errors ?? []).map(
        (e) => `${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`,
      );
      throw new EntitySchemaViolationError(
        `${entityName}@${version}`,
        errors,
      );
    }
  }
}

/** Compute sha256 checksum of schema content for publish integrity. */
export function schemaChecksum(
  schema: Record<string, unknown>,
): string {
  // Stable stringification: sort keys recursively so checksums are
  // deterministic regardless of property order.
  const canonical = canonicalJsonStringify(schema);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]))
      .join(',') +
    '}'
  );
}

/** For tests. */
export function _resetSchemaCache(): void {
  _validators.clear();
}
