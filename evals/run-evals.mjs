import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const backendDir = resolve(rootDir, 'backend');

execFileSync(
  process.execPath,
  [resolve(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'scripts/run-evals.ts'],
  { cwd: backendDir, stdio: 'inherit' },
);
