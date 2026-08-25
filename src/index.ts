#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('mp-token-drift')
  .description('Detect design system token drift via AST analysis')
  .version('1.0.0');

program
  .command('scan')
  .description('Scan source files for design token drift')
  .argument('<path>', 'path to scan')
  .action((path: string) => {
    console.log(chalk.cyan(`Scanning ${path} for token drift...`));
  });

program.parse();
