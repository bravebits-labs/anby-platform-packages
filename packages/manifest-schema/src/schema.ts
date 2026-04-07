// Auto-shaped from schema.json. Inlined as a TS module so the package works
// in both ESM and CJS without runtime JSON import attributes.
// If you edit this, also edit src/schema.json so the on-disk artifact stays
// in sync (it is shipped in the tarball for external tooling).

export const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://anby.dev/schemas/app-manifest.v1.json',
  title: 'Anby App Manifest',
  type: 'object',
  required: ['id', 'version', 'name', 'runtime', 'frontend', 'provides', 'requires', 'permissions', 'database'],
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9]*\\.[a-z][a-z0-9]*\\.[a-z][a-z0-9-]*$', description: 'Reverse domain app ID' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    icon: { type: 'string' },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    runtime: {
      type: 'object',
      required: ['type', 'port', 'healthCheck'],
      properties: {
        type: { type: 'string', enum: ['remix', 'nestjs', 'nextjs', 'docker'] },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        healthCheck: { type: 'string' },
        readyCheck: { type: 'string' },
      },
    },
    frontend: {
      type: 'object',
      required: ['type', 'routes'],
      properties: {
        type: { type: 'string', enum: ['iframe', 'module-federation'] },
        routes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'label'],
            properties: {
              path: { type: 'string' },
              label: { type: 'string' },
              icon: { type: 'string' },
              adminOnly: { type: 'boolean' },
            },
          },
          minItems: 1,
        },
        navPosition: { type: 'string', enum: ['sidebar', 'hidden'], default: 'sidebar' },
      },
    },
    provides: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$' },
                  version: { type: 'string', pattern: '^v\\d+$' },
                  schema: {
                    oneOf: [{ type: 'string' }, { type: 'object' }],
                  },
                  schemaChecksum: { type: 'string' },
                },
              },
            ],
          },
        },
        events: { type: 'array', items: { type: 'string' } },
        widgets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              size: { type: 'string', enum: ['sm', 'md', 'lg'] },
            },
          },
        },
      },
    },
    requires: {
      type: 'object',
      properties: {
        platform: { type: 'array', items: { type: 'string' } },
        entities: { type: 'array', items: { type: 'string' } },
        events: { type: 'array', items: { type: 'string' } },
        optional: {
          type: 'object',
          properties: {
            entities: { type: 'array', items: { type: 'string' } },
            events: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    settings: {
      type: 'object',
      properties: {
        schema: { type: 'object' },
      },
    },
    permissions: { type: 'array', items: { type: 'string' } },
    database: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['postgresql'] },
        migrationDir: { type: 'string' },
      },
    },
  },
} as const;
