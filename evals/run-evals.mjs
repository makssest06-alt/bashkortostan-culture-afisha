import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const backendDir = resolve(rootDir, 'backend');
const args = process.argv.slice(2);
if (['--external', '--holdout'].includes(args[0]) && args[1]) args[1] = resolve(args[1]);

execFileSync(
  process.execPath,
  [resolve(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'scripts/run-evals.ts', ...args],
  { cwd: backendDir, stdio: 'inherit' },
);
