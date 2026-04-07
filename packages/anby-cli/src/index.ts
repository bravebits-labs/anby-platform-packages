#!/usr/bin/env node
import { Command } from 'commander';
import kleur from 'kleur';
import { registerAppCommands } from './commands/index.js';

const program = new Command();

program
  .name('anby')
  .description('Anby platform CLI — publish, install, and manage apps')
  .version('0.1.0');

registerAppCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(kleur.red(`✖ ${(err as Error).message}`));
  process.exit(1);
});
