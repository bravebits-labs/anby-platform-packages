/**
 * @anby/platform-sdk/vite — Vite plugin for Anby app integration.
 *
 * Two responsibilities:
 *
 * 1. **Auto-scan** source code to discover entity/event declarations and
 *    keep `anby-app.manifest.json` in sync — developer never edits
 *    provides/requires by hand.
 *
 * 2. **Codegen** typed module augmentations (`.anby/types.d.ts`) so
 *    `publishEvent` gets compile-time type checking.
 *
 * Runs on every dev start and on source/manifest file changes.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, resolve, isAbsolute, join, basename, relative } from 'node:path';
import type { Plugin } from 'vite';
import { getInlinedManifest } from '../apps/publish.js';

export interface AnbyVitePluginOptions {
  /** Path to the manifest file relative to vite root. Default: `./anby-app.manifest.json`. */
  manifestPath?: string;
  /** Output path for generated types relative to vite root. Default: `./.anby/types.d.ts`. */
  outFile?: string;
  /** Output path for the wire-format manifest static asset. Default: `./public/_anby/manifest.json`. */
  manifestArtifactPath?: string;
  /** Source directories to scan for entity/event usage. Default: `['./app']`. */
  scanDirs?: string[];
  /** Disable auto-scan (only codegen from manifest). Default: false. */
  disableAutoScan?: boolean;
}

interface ManifestEventsShape {
  provides?: { events?: string[]; entities?: Array<string | { name: string; version: string; schema?: unknown }> };
  requires?: { events?: string[]; entities?: string[] };
}

// ── Auto-scan: discover entities/events from source code ──────────────

interface ScanResult {
  providesEntities: Array<{ name: string; version: string; schema: string }>;
  providesEvents: string[];
  requiresEntities: string[];
}

/**
 * Scan source files for SDK API usage patterns:
 *   - getEntityClient('org.period@v1') → requires entity
 *   - publishEvent({ type: 'org.node.created' ... }) → provides event
 *   - app/schemas/*.v*.json files → provides entities
 */
function scanSourceCode(root: string, scanDirs: string[]): ScanResult {
  const providesEvents = new Set<string>();
  const requiresEntities = new Set<string>();
  const providesEntities: Array<{ name: string; version: string; schema: string }> = [];

  // 1. Scan for entity schema files: app/schemas/{name}.{version}.json
  const schemasDir = resolve(root, 'app/schemas');
  if (existsSync(schemasDir)) {
    try {
      const files = readdirSync(schemasDir);
      for (const file of files) {
        // Match: org-period.v1.json → name=org.period, version=v1
        const match = file.match(/^(.+)\.(v\d+)\.json$/);
        if (match) {
          const rawName = match[1]; // "org-period"
          const version = match[2]; // "v1"
          // Convert filename to entity name: "org-period" → "org.period"
          const entityName = rawName.replace(/-/g, '.');
          const schemaPath = `./app/schemas/${file}`;
          providesEntities.push({ name: entityName, version, schema: schemaPath });
        }
      }
    } catch {
      // schemas dir unreadable — skip
    }
  }

  // 2. Scan source files for API usage patterns
  for (const dir of scanDirs) {
    const absDir = isAbsolute(dir) ? dir : resolve(root, dir);
    if (!existsSync(absDir)) continue;
    walkFiles(absDir, (filePath) => {
      if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) return;
      // Skip node_modules and generated files
      if (filePath.includes('node_modules') || filePath.includes('.anby/')) return;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        return;
      }

      // Pattern 1: getEntityClient('org.period@v1')
      const entityClientRegex1 = /getEntityClient\s*\(\s*['"]([^'"]+@[^'"]+)['"]/g;
      for (const match of content.matchAll(entityClientRegex1)) {
        requiresEntities.add(match[1]); // e.g. "org.period@v1"
      }

      // Pattern 2: getEntityClient(tenantId, 'org.period', 'v1') or getEntityClient<T>(tenantId, 'org.period', 'v1')
      const entityClientRegex2 = /getEntityClient\s*(?:<[^>]+>)?\s*\([^,]+,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
      for (const match of content.matchAll(entityClientRegex2)) {
        requiresEntities.add(`${match[1]}@${match[2]}`); // e.g. "org.period@v1"
      }

      // publishEvent({ type: 'org.node.created' ... })
      const publishEventRegex = /publishEvent\s*\(\s*\{[^}]*?type\s*:\s*['"]([^'"]+)['"]/g;
      for (const match of content.matchAll(publishEventRegex)) {
        providesEvents.add(match[1]);
      }

      // createEvent({ type: 'org.node.created' ... })
      const createEventRegex = /createEvent\s*\(\s*\{[^}]*?type\s*:\s*['"]([^'"]+)['"]/g;
      for (const match of content.matchAll(createEventRegex)) {
        providesEvents.add(match[1]);
      }

      // Type union declarations near publishEvent context:
      //   type: 'org.node.created' | 'org.node.updated' | 'org.node.deleted'
      // Matches dotted string literals in union type annotations
      const typeUnionRegex = /type\s*:\s*((?:['"][a-z][a-z0-9.]*[a-z0-9]['"](?:\s*\|\s*)?)+)/g;
      for (const unionMatch of content.matchAll(typeUnionRegex)) {
        const unionStr = unionMatch[1];
        const literalRegex = /['"]([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)['"]/g;
        for (const litMatch of unionStr.matchAll(literalRegex)) {
          providesEvents.add(litMatch[1]);
        }
      }
    });
  }

  return {
    providesEntities,
    providesEvents: [...providesEvents].sort(),
    requiresEntities: [...requiresEntities].sort(),
  };
}

function walkFiles(dir: string, callback: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.anby' || entry === 'build') continue;
        walkFiles(full, callback);
      } else if (stat.isFile()) {
        callback(full);
      }
    } catch {
      // skip unreadable
    }
  }
}

// ── Manifest sync: merge scan results into manifest ───────────────────

function syncManifest(manifestPath: string, scan: ScanResult): boolean {
  if (!existsSync(manifestPath)) return false;

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    return false;
  }

  const manifest = JSON.parse(raw);
  let changed = false;

  // Sync provides.entities
  if (scan.providesEntities.length > 0) {
    const current = JSON.stringify(manifest.provides?.entities ?? []);
    const scanned = JSON.stringify(scan.providesEntities);
    if (current !== scanned) {
      manifest.provides = manifest.provides || {};
      manifest.provides.entities = scan.providesEntities;
      changed = true;
    }
  }

  // Sync provides.events
  if (scan.providesEvents.length > 0) {
    const current = JSON.stringify((manifest.provides?.events ?? []).slice().sort());
    const scanned = JSON.stringify(scan.providesEvents);
    if (current !== scanned) {
      manifest.provides = manifest.provides || {};
      manifest.provides.events = scan.providesEvents;
      changed = true;
    }
  }

  // Sync requires.entities
  if (scan.requiresEntities.length > 0) {
    const current = JSON.stringify((manifest.requires?.entities ?? []).slice().sort());
    const scanned = JSON.stringify(scan.requiresEntities);
    if (current !== scanned) {
      manifest.requires = manifest.requires || {};
      manifest.requires.entities = scan.requiresEntities;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log('[anby-vite] ✔ Auto-updated manifest from source code scan');
    const parts: string[] = [];
    if (scan.providesEntities.length) parts.push(`provides ${scan.providesEntities.length} entities`);
    if (scan.providesEvents.length) parts.push(`provides ${scan.providesEvents.length} events`);
    if (scan.requiresEntities.length) parts.push(`requires ${scan.requiresEntities.length} entities`);
    if (parts.length) console.log(`[anby-vite]   ${parts.join(', ')}`);
  }

  return changed;
}

// ── Codegen: typed module augmentations ───────────────────────────────

function renderTypes(provides: string[], requires: string[]): string {
  const sections: string[] = [];

  sections.push('// Generated by @anby/platform-sdk/vite — DO NOT EDIT.');
  sections.push('// Re-runs whenever anby-app.manifest.json changes.');
  sections.push('');
  sections.push("declare module '@anby/platform-sdk' {");

  if (provides.length > 0) {
    sections.push('  interface AppProvidedEvents {');
    for (const name of provides) {
      sections.push(`    ${JSON.stringify(name)}: Record<string, unknown>;`);
    }
    sections.push('  }');
  } else {
    sections.push('  interface AppProvidedEvents {}');
  }

  if (requires.length > 0) {
    sections.push('  interface AppRequiredEvents {');
    for (const name of requires) {
      sections.push(`    ${JSON.stringify(name)}: Record<string, unknown>;`);
    }
    sections.push('  }');
  } else {
    sections.push('  interface AppRequiredEvents {}');
  }

  sections.push('}');
  sections.push('');
  sections.push('export {};');
  sections.push('');

  return sections.join('\n');
}

function readManifestEvents(manifestAbsPath: string): {
  provides: string[];
  requires: string[];
} {
  const raw = readFileSync(manifestAbsPath, 'utf-8');
  const parsed = JSON.parse(raw) as ManifestEventsShape;
  const provides = Array.isArray(parsed.provides?.events) ? parsed.provides!.events! : [];
  const requires = Array.isArray(parsed.requires?.events) ? parsed.requires!.events! : [];
  return { provides, requires };
}

// ── Plugin ────────────────────────────────────────────────────────────

export function anbyVitePlugin(opts: AnbyVitePluginOptions = {}): Plugin {
  const manifestRelative = opts.manifestPath ?? './anby-app.manifest.json';
  const outRelative = opts.outFile ?? './.anby/types.d.ts';
  const artifactRelative =
    opts.manifestArtifactPath ?? './public/_anby/manifest.json';
  const scanDirsRelative = opts.scanDirs ?? ['./app'];
  const autoScan = opts.disableAutoScan !== true;

  let root = '';
  let resolvedManifest = '';
  let resolvedOut = '';
  let resolvedArtifact = '';

  function runAutoScan() {
    if (!autoScan) return;
    if (!existsSync(resolvedManifest)) return;
    try {
      const scan = scanSourceCode(root, scanDirsRelative);
      syncManifest(resolvedManifest, scan);
    } catch (err) {
      console.warn(`[anby-vite] auto-scan failed: ${(err as Error).message}`);
    }
  }

  function generateTypes() {
    if (!existsSync(resolvedManifest)) {
      console.warn(
        `[anby-vite] manifest not found at ${resolvedManifest} — skipping codegen`,
      );
      return;
    }
    try {
      const { provides, requires } = readManifestEvents(resolvedManifest);
      const content = renderTypes(provides, requires);
      mkdirSync(dirname(resolvedOut), { recursive: true });
      writeFileSync(resolvedOut, content);
    } catch (err) {
      console.warn(
        `[anby-vite] codegen failed: ${(err as Error).message}`,
      );
    }
  }

  async function generateManifestArtifact() {
    if (!existsSync(resolvedManifest)) return;
    try {
      const inlined = await getInlinedManifest({
        manifestPath: resolvedManifest,
      });
      mkdirSync(dirname(resolvedArtifact), { recursive: true });
      writeFileSync(resolvedArtifact, JSON.stringify(inlined, null, 2));
    } catch (err) {
      console.warn(
        `[anby-vite] manifest artifact write failed: ${(err as Error).message}`,
      );
    }
  }

  function regenerateAll() {
    runAutoScan();      // 1. Scan code → update manifest
    generateTypes();    // 2. Read manifest → generate types
    void generateManifestArtifact(); // 3. Read manifest → generate wire artifact
  }

  return {
    name: '@anby/platform-sdk/vite',

    configResolved(config) {
      root = config.root;
      resolvedManifest = isAbsolute(manifestRelative)
        ? manifestRelative
        : resolve(root, manifestRelative);
      resolvedOut = isAbsolute(outRelative)
        ? outRelative
        : resolve(root, outRelative);
      resolvedArtifact = isAbsolute(artifactRelative)
        ? artifactRelative
        : resolve(root, artifactRelative);
    },

    buildStart() {
      regenerateAll();
    },

    configureServer(server) {
      // Watch manifest + source dirs
      server.watcher.add(resolvedManifest);
      for (const dir of scanDirsRelative) {
        const absDir = isAbsolute(dir) ? dir : resolve(root, dir);
        if (existsSync(absDir)) server.watcher.add(absDir);
      }

      let scanTimer: ReturnType<typeof setTimeout> | null = null;

      server.watcher.on('change', (changedPath) => {
        const abs = resolve(changedPath);
        if (abs === resolvedManifest) {
          // Manifest changed directly — regenerate types + artifact (no re-scan)
          generateTypes();
          void generateManifestArtifact();
        } else if (changedPath.match(/\.(ts|tsx|js|jsx)$/)) {
          // Debounce source scans — many files change at once during HMR
          if (scanTimer) clearTimeout(scanTimer);
          scanTimer = setTimeout(() => {
            scanTimer = null;
            regenerateAll();
          }, 2000);
        }
      });
    },
  };
}
