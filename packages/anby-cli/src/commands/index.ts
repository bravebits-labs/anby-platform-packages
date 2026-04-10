import type { Command } from 'commander';
import { initCommand } from './init.js';
import { validateCommand } from './validate.js';
import { publishCommand } from './publish.js';
import { installCommand } from './install.js';
import { listCommand } from './list.js';
import { codegenCommand } from './codegen.js';
import { loginCommand } from './login.js';
import { logoutCommand } from './logout.js';

/**
 * All app-lifecycle commands live under `anby app <verb>` so we can add
 * other command namespaces later (`anby tenant`, `anby events`, etc.)
 * without reshuffling.
 *
 * `init` is also exposed as a top-level `anby init` alias because that's
 * the command publishers reach for first and the namespace prefix would
 * be a needless papercut on the very first interaction with the CLI.
 */
export function registerAppCommands(program: Command) {
  // ── Top-level auth commands ──────────────────────────────────────────
  program
    .command('login')
    .description('Authenticate with the Anby platform via Google OAuth')
    .option('--auth-url <url>', '[dev] Override auth service URL')
    .action(loginCommand);

  program
    .command('logout')
    .description('Remove stored CLI credentials')
    .action(logoutCommand);

  const app = program.command('app').description('Manage Anby apps');

  // Top-level alias: `anby init` → same as `anby app init`.
  program
    .command('init')
    .description('Scaffold and register an Anby app (interactive)')
    .option('--registry-url <url>', '[dev] Override registry URL')
    .action(initCommand);

  app
    .command('init')
    .description('Scaffold and register an Anby app (interactive)')
    .option('--registry-url <url>', '[dev] Override registry URL')
    .action(initCommand);

  app
    .command('validate')
    .description('Validate the manifest in the current directory against the schema')
    .option('--manifest <path>', 'Path to manifest file', './anby-app.manifest.json')
    .action(validateCommand);

  app
    .command('publish')
    .description('Publish the app to the registry (HMAC-authenticated)')
    .option('--manifest <path>', 'Path to manifest file', './anby-app.manifest.json')
    .option('--registry <url>', 'Registry base URL', process.env.REGISTRY_URL || 'http://localhost:3003')
    .option('--public-url <url>', 'Public URL where this service is reachable')
    .option('--changelog <text>', 'Optional changelog note attached to this version')
    .option('--featured', 'Flag the app as featured in the setup wizard')
    .option('--save-to <path>', 'Write the assembled ANBY_APP_TOKEN to this file (e.g. .env.local)')
    .option('--platform-url <url>', 'Override the platform base URL embedded in the token (defaults to registry URL with /registry stripped)')
    .action(publishCommand);

  app
    .command('install')
    .description('Install an app for a tenant')
    .requiredOption('--tenant <tenantId>', 'Tenant ID')
    .requiredOption('--app <appId>', 'App ID to install')
    .option('--registry <url>', 'Registry base URL', process.env.REGISTRY_URL || 'http://localhost:3003')
    .action(installCommand);

  app
    .command('list')
    .description('List apps (marketplace by default, installed with --tenant)')
    .option('--tenant <tenantId>', 'Show installed apps for this tenant')
    .option('--registry <url>', 'Registry base URL', process.env.REGISTRY_URL || 'http://localhost:3003')
    .action(listCommand);

  app
    .command('codegen')
    .description('Generate TypeScript types from anby-app.manifest.json (event names, etc)')
    .option('--manifest <path>', 'Path to manifest file', './anby-app.manifest.json')
    .option('--out <path>', 'Output path for generated types', './.anby/types.d.ts')
    .option('--watch', 'Watch the manifest and regenerate on change')
    .action(codegenCommand);
}
