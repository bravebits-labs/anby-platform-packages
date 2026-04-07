// Writes the per-folder package.json overrides that tell Node how to parse
// the compiled output of dual ESM/CJS packages.
//
// Run from a package directory after `tsc -p tsconfig.cjs.json && tsc -p tsconfig.esm.json`.
// Without these helper files, Node falls back to the parent package.json's
// `"type"` field — which is unset (= commonjs) — and parses the ESM build as
// CJS, breaking named imports.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const pairs = [
  ['dist/cjs/package.json', { type: 'commonjs' }],
  ['dist/esm/package.json', { type: 'module' }],
];

for (const [path, body] of pairs) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(body) + '\n');
  console.log(`✓ wrote ${path}`);
}
