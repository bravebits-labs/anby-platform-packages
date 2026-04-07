import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishAppFromManifest } from './publish.js';

let fetchMock: typeof fetch | undefined;
const origFetch = globalThis.fetch;

function captureFetch(): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url: u, body });
    return new Response(
      JSON.stringify({
        app: { id: 'com.test.app', name: 'test', publicUrl: null, status: 'published' },
        version: { appId: 'com.test.app', version: '1.0.0' },
        privateKey: null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  globalThis.fetch = fetchMock;
  return { calls };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'anby-publish-test-'));
  process.env.INTERNAL_API_SECRET = 'test-secret';
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  globalThis.fetch = origFetch;
  delete process.env.INTERNAL_API_SECRET;
  delete process.env.REGISTRY_URL;
});

describe('publishAppFromManifest — schema inlining (CR-4)', () => {
  it('inlines JSON schema content from relative path', async () => {
    const schemaContent = {
      $id: 'https://anby.dev/schemas/test.v1.json',
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    };
    writeFileSync(
      join(workDir, 'schema.json'),
      JSON.stringify(schemaContent),
    );
    const manifest = {
      id: 'com.test.app',
      version: '1.0.0',
      name: 'Test',
      runtime: { type: 'remix', port: 4000, healthCheck: '/health' },
      frontend: { type: 'iframe', routes: [{ path: '/', label: 'Home' }] },
      provides: {
        entities: [
          { name: 'test.entity', version: 'v1', schema: './schema.json' },
        ],
      },
      requires: { platform: [] },
      permissions: [],
      database: { type: 'postgresql' },
    };
    writeFileSync(join(workDir, 'anby-app.manifest.json'), JSON.stringify(manifest));

    const { calls } = captureFetch();
    const result = await publishAppFromManifest({
      manifestPath: join(workDir, 'anby-app.manifest.json'),
      registryUrl: 'http://fake-registry',
    });
    expect(result).toBeTruthy();
    expect(calls.length).toBe(1);

    const sent = calls[0].body as {
      manifest: { provides: { entities: Array<{ schema: unknown; schemaChecksum?: string }> } };
    };
    const inlined = sent.manifest.provides.entities[0];
    // Must be inlined (object), not path (string).
    expect(typeof inlined.schema).toBe('object');
    expect((inlined.schema as { type: string }).type).toBe('object');
    // Checksum must be populated.
    expect(typeof inlined.schemaChecksum).toBe('string');
    expect(inlined.schemaChecksum!.length).toBeGreaterThan(0);
  });

  it('passes through already-inlined schemas and computes missing checksum', async () => {
    const manifest = {
      id: 'com.test.app',
      version: '1.0.0',
      name: 'Test',
      runtime: { type: 'remix', port: 4000, healthCheck: '/health' },
      frontend: { type: 'iframe', routes: [{ path: '/', label: 'Home' }] },
      provides: {
        entities: [
          {
            name: 'test.entity',
            version: 'v1',
            schema: { type: 'object', properties: { x: { type: 'string' } } },
          },
        ],
      },
      requires: { platform: [] },
      permissions: [],
      database: { type: 'postgresql' },
    };
    writeFileSync(join(workDir, 'anby-app.manifest.json'), JSON.stringify(manifest));

    const { calls } = captureFetch();
    await publishAppFromManifest({
      manifestPath: join(workDir, 'anby-app.manifest.json'),
      registryUrl: 'http://fake-registry',
    });
    const sent = calls[0].body as {
      manifest: { provides: { entities: Array<{ schema: unknown; schemaChecksum?: string }> } };
    };
    expect(typeof sent.manifest.provides.entities[0].schema).toBe('object');
    expect(sent.manifest.provides.entities[0].schemaChecksum).toBeTruthy();
  });

  it('throws with a clear error when schema file is missing', async () => {
    const manifest = {
      id: 'com.test.app',
      version: '1.0.0',
      name: 'Test',
      runtime: { type: 'remix', port: 4000, healthCheck: '/health' },
      frontend: { type: 'iframe', routes: [{ path: '/', label: 'Home' }] },
      provides: {
        entities: [
          { name: 'test.entity', version: 'v1', schema: './missing.json' },
        ],
      },
      requires: { platform: [] },
      permissions: [],
      database: { type: 'postgresql' },
    };
    writeFileSync(join(workDir, 'anby-app.manifest.json'), JSON.stringify(manifest));
    await expect(
      publishAppFromManifest({
        manifestPath: join(workDir, 'anby-app.manifest.json'),
        registryUrl: 'http://fake-registry',
      }),
    ).rejects.toThrow(/unable to read schema file/);
  });

  it('leaves entities without schemas untouched', async () => {
    const manifest = {
      id: 'com.test.app',
      version: '1.0.0',
      name: 'Test',
      runtime: { type: 'remix', port: 4000, healthCheck: '/health' },
      frontend: { type: 'iframe', routes: [{ path: '/', label: 'Home' }] },
      provides: {
        entities: [{ name: 'test.entity', version: 'v1' }],
      },
      requires: { platform: [] },
      permissions: [],
      database: { type: 'postgresql' },
    };
    writeFileSync(join(workDir, 'anby-app.manifest.json'), JSON.stringify(manifest));
    const { calls } = captureFetch();
    await publishAppFromManifest({
      manifestPath: join(workDir, 'anby-app.manifest.json'),
      registryUrl: 'http://fake-registry',
    });
    const sent = calls[0].body as {
      manifest: { provides: { entities: Array<{ name: string; schema?: unknown }> } };
    };
    expect(sent.manifest.provides.entities[0].name).toBe('test.entity');
    expect(sent.manifest.provides.entities[0].schema).toBeUndefined();
  });
});
